/**
 * AST-based semantic relationship extractor.
 *
 * Piggybacks on the TypeScript Compiler API (ts.createSourceFile) to extract
 * relationships the existing import-only dependency graph misses:
 *
 *   FUNCTION_CALL   — file A calls an imported function from file B
 *   CLASS_EXTENDS   — file A's class extends an imported class from file B
 *   IMPLEMENTS      — file A's class implements an imported interface from file B
 *   COMMENTS_ABOUT  — "why:", "rationale:", JSDoc summaries embedded as WhyNodes
 *
 * Confidence is always EXTRACTED (direct AST evidence) for calls/heritage and
 * INFERRED for JSDoc (not always a hard relationship).
 *
 * Usage:
 *   const extractor = new RelationshipExtractor();
 *   const result = extractor.extractFromFile(filePath, knownFilesSet);
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { EnrichedEdge, WhyNode, RelationshipType, RELATIONSHIP_WEIGHTS } from './relationship-types';

export interface ExtractionResult {
  enrichedEdges: EnrichedEdge[];
  whyComments: WhyNode[];
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const WHY_PATTERNS = [
  /\/\/\s*why:\s*(.+)/i,
  /\/\/\s*rationale:\s*(.+)/i,
  /\/\/\s*because:\s*(.+)/i,
  /\/\/\s*reason:\s*(.+)/i,
];

export class RelationshipExtractor {
  /**
   * Extract semantic relationships from a single file.
   *
   * @param filePath   Absolute path to analyze.
   * @param knownFiles Set of absolute paths already tracked in the graph.
   *                   Only imports resolving to known files generate edges.
   */
  extractFromFile(filePath: string, knownFiles: ReadonlySet<string>): ExtractionResult {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      return { enrichedEdges: [], whyComments: [] };
    }

    const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const importMap = this.buildImportMap(sf, path.dirname(filePath), knownFiles);

    return {
      enrichedEdges: [
        ...this.extractFunctionCalls(sf, filePath, importMap),
        ...this.extractClassRelations(sf, filePath, importMap),
      ],
      whyComments: this.extractWhyComments(content, filePath),
    };
  }

  // ── Import map ─────────────────────────────────────────────

  private buildImportMap(
    sf: ts.SourceFile,
    dir: string,
    knownFiles: ReadonlySet<string>,
  ): Map<string, string> {
    const map = new Map<string, string>(); // localName → resolved absolute path

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        const rawSpec = (node.moduleSpecifier as ts.StringLiteral).text;
        if (!rawSpec.startsWith('.')) {
          ts.forEachChild(node, visit);
          return; // skip npm packages
        }
        const resolved = this.resolveModule(rawSpec, dir);
        if (!resolved || !knownFiles.has(resolved)) {
          ts.forEachChild(node, visit);
          return;
        }

        const clause = node.importClause;
        if (!clause) { ts.forEachChild(node, visit); return; }

        // default import: import Foo from './foo'
        if (clause.name) map.set(clause.name.text, resolved);

        if (clause.namedBindings) {
          if (ts.isNamedImports(clause.namedBindings)) {
            // named: import { foo, bar as baz } from './foo'
            for (const el of clause.namedBindings.elements) {
              map.set(el.name.text, resolved);
            }
          } else if (ts.isNamespaceImport(clause.namedBindings)) {
            // namespace: import * as mod from './foo'
            map.set(clause.namedBindings.name.text, resolved);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return map;
  }

  // ── Function calls ─────────────────────────────────────────

  private extractFunctionCalls(
    sf: ts.SourceFile,
    filePath: string,
    importMap: Map<string, string>,
  ): EnrichedEdge[] {
    const edges: EnrichedEdge[] = [];
    // Deduplicate per target file (one edge per file pair, not per call site)
    const seen = new Set<string>();

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const localName = this.resolveCalleeName(node.expression);
        if (localName && importMap.has(localName)) {
          const target = importMap.get(localName)!;
          const key = `${filePath}→${target}:FUNCTION_CALL`;
          if (!seen.has(key)) {
            seen.add(key);
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            edges.push({
              source: filePath,
              target,
              type: 'FUNCTION_CALL',
              confidence: 'EXTRACTED',
              weight: RELATIONSHIP_WEIGHTS.FUNCTION_CALL,
              rationale: `calls ${localName} (first at line ${line + 1})`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return edges;
  }

  private resolveCalleeName(expr: ts.Expression): string | null {
    if (ts.isIdentifier(expr)) return expr.text;
    // obj.method() — check if `obj` is the imported name
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
      return expr.expression.text;
    }
    return null;
  }

  // ── Class heritage ─────────────────────────────────────────

  private extractClassRelations(
    sf: ts.SourceFile,
    filePath: string,
    importMap: Map<string, string>,
  ): EnrichedEdge[] {
    const edges: EnrichedEdge[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const className = ts.isClassDeclaration(node) ? (node.name?.text ?? '<anonymous>') : '<expr>';
        for (const clause of node.heritageClauses ?? []) {
          const relType: RelationshipType =
            clause.token === ts.SyntaxKind.ExtendsKeyword ? 'CLASS_EXTENDS' : 'IMPLEMENTS';
          for (const typeRef of clause.types) {
            const baseName = ts.isIdentifier(typeRef.expression) ? typeRef.expression.text : null;
            if (baseName && importMap.has(baseName)) {
              edges.push({
                source: filePath,
                target: importMap.get(baseName)!,
                type: relType,
                confidence: 'EXTRACTED',
                weight: RELATIONSHIP_WEIGHTS[relType],
                rationale: `${className} ${relType === 'CLASS_EXTENDS' ? 'extends' : 'implements'} ${baseName}`,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return edges;
  }

  // ── Why comments ───────────────────────────────────────────

  private extractWhyComments(content: string, filePath: string): WhyNode[] {
    const nodes: WhyNode[] = [];
    const lines = content.split('\n');

    // Inline why: / rationale: comments
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of WHY_PATTERNS) {
        const m = lines[i]!.match(pattern);
        if (m?.[1]) {
          nodes.push({
            id: `${filePath}:${i + 1}:why`,
            text: m[1].trim().slice(0, 300),
            file: filePath,
            line: i + 1,
          });
          break;
        }
      }
    }

    // JSDoc block summaries (first non-empty line after /**, ignoring @tags)
    const jsdocRe = /\/\*\*([\s\S]*?)\*\//g;
    let m: RegExpExecArray | null;
    while ((m = jsdocRe.exec(content)) !== null) {
      const rawLines = m[1]!.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean);
      const summary = rawLines.find(l => l.length > 10 && !l.startsWith('@'));
      if (summary) {
        const lineNum = content.substring(0, m.index).split('\n').length;
        nodes.push({
          id: `${filePath}:${lineNum}:jsdoc`,
          text: summary.slice(0, 300),
          file: filePath,
          line: lineNum,
        });
      }
    }

    return nodes;
  }

  // ── Module resolution ──────────────────────────────────────

  private resolveModule(specifier: string, dir: string): string | null {
    const base = path.resolve(dir, specifier);
    for (const ext of EXTENSIONS) {
      const full = base + ext;
      if (fs.existsSync(full)) return full;
    }
    for (const ext of EXTENSIONS) {
      const index = path.join(base, `index${ext}`);
      if (fs.existsSync(index)) return index;
    }
    return null;
  }
}
