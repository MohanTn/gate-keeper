/**
 * In-memory code analysis using the TypeScript Compiler API.
 * Analyzes code strings (not files on disk) — used by the MCP server's
 * `analyze_code` tool to evaluate snippets before they touch the filesystem.
 */

import * as ts from 'typescript';
import { Dependency, Metrics, Violation, Language } from '../types';
import { RatingCalculator } from '../rating/rating-calculator';

export interface StringAnalysisResult {
  language: Language;
  violations: Violation[];
  metrics: Metrics;
  dependencies: Dependency[];
  rating: number;
}

export class StringAnalyzer {
  private ratingCalc = new RatingCalculator();

  analyze(code: string, language: Language): StringAnalysisResult {
    if (language === 'csharp') {
      return this.analyzeCSharpString(code);
    }
    return this.analyzeTypeScriptString(code, language);
  }

  // ── TypeScript / React ───────────────────────────────────

  private analyzeTypeScriptString(code: string, language: Language): StringAnalysisResult {
    const isReact = language === 'tsx' || language === 'jsx';
    const filename = `snippet.${language === 'tsx' ? 'tsx' : language === 'jsx' ? 'jsx' : 'ts'}`;

    const sourceFile = ts.createSourceFile(
      filename, code, ts.ScriptTarget.Latest, true,
      isReact ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const metrics = this.calculateMetrics(sourceFile, code);
    const violations = isReact
      ? this.detectReactViolations(sourceFile)
      : this.detectTypeScriptViolations(sourceFile);
    violations.push(...this.detectTodoPlaceholders(code));
    const dependencies = this.extractDependencies(sourceFile);
    const rating = this.ratingCalc.calculate(violations, metrics, dependencies);

    return { language, violations, metrics, dependencies, rating };
  }

  // ── C# (heuristic / text-based) ─────────────────────────

  private analyzeCSharpString(code: string): StringAnalysisResult {
    const lines = code.split('\n');
    const violations: Violation[] = [];
    let methodCount = 0;
    let classCount = 0;
    let currentMethodLines = 0;
    let inMethod = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (/\bclass\s+\w+/.test(line)) classCount++;

      if (/\b(public|private|protected|internal)\s+\w+.*\(/.test(line) && !line.includes('class')) {
        methodCount++;
        inMethod = true;
        currentMethodLines = 0;

        const paramMatch = line.match(/\(([^)]*)\)/);
        if (paramMatch) {
          const params = paramMatch[1].split(',').filter(p => p.trim());
          if (params.length > 5) {
            violations.push({
              type: 'tight_coupling', severity: 'warning',
              message: `Constructor/method at line ${i + 1} has ${params.length} parameters (>5)`,
              line: i + 1,
            });
          }
        }
      }

      if (inMethod) {
        currentMethodLines++;
        if (line.includes('{')) braceDepth++;
        if (line.includes('}')) {
          braceDepth--;
          if (braceDepth <= 0) {
            if (currentMethodLines > 50) {
              violations.push({
                type: 'long_method', severity: 'warning',
                message: `Method ending at line ${i + 1} is ${currentMethodLines} lines (>50)`,
                line: i + 1,
              });
            }
            inMethod = false;
            currentMethodLines = 0;
          }
        }
      }

      if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
        violations.push({
          type: 'empty_catch', severity: 'error',
          message: `Empty catch block at line ${i + 1}`, line: i + 1,
        });
      }
    }

    if (methodCount > 20) {
      violations.push({
        type: 'god_class', severity: 'warning',
        message: `Class has ${methodCount} methods (>20) — consider splitting`,
      });
    }

    violations.push(...this.detectTodoPlaceholders(code));

    const metrics: Metrics = {
      linesOfCode: lines.length,
      cyclomaticComplexity: Math.max(1, methodCount),
      numberOfMethods: methodCount,
      numberOfClasses: classCount,
      importCount: lines.filter(l => l.trim().startsWith('using ')).length,
    };

    const rating = this.ratingCalc.calculate(violations, metrics, []);
    return { language: 'csharp', violations, metrics, dependencies: [], rating };
  }

  // ── Shared helpers ───────────────────────────────────────

  private extractDependencies(sourceFile: ts.SourceFile): Dependency[] {
    const deps: Dependency[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
        deps.push({ source: 'snippet', target: specifier, type: 'import', weight: 1 });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return deps;
  }

  private calculateMetrics(sourceFile: ts.SourceFile, content: string): Metrics {
    let methodCount = 0, classCount = 0, complexity = 1;
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) methodCount++;
      if (ts.isClassDeclaration(node)) classCount++;
      if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isForStatement(node) ||
        ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isCaseClause(node) ||
        ts.isConditionalExpression(node) || ts.isCatchClause(node)) complexity++;
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return {
      linesOfCode: content.split('\n').length,
      cyclomaticComplexity: complexity,
      numberOfMethods: methodCount,
      numberOfClasses: classCount,
      importCount: sourceFile.statements.filter(ts.isImportDeclaration).length,
    };
  }

  private detectTypeScriptViolations(sourceFile: ts.SourceFile): Violation[] {
    const violations: Violation[] = [];
    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          type: 'any_usage', severity: 'warning',
          message: `Usage of 'any' type at line ${pos.line + 1}`, line: pos.line + 1,
          fix: 'Replace with a specific type or use unknown',
        });
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'console') {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          type: 'console_log', severity: 'info',
          message: `console.${node.expression.name.text} at line ${pos.line + 1}`, line: pos.line + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return violations;
  }

  private detectReactViolations(sourceFile: ts.SourceFile): Violation[] {
    const violations: Violation[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'map') {
        const cb = node.arguments[0];
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          if (this.bodyContainsJSX(cb.body) && !this.bodyHasKeyProp(cb.body)) {
            const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            violations.push({
              type: 'missing_key', severity: 'error',
              message: `Missing 'key' prop in .map() JSX at line ${pos.line + 1}`, line: pos.line + 1,
              fix: 'Add a unique key prop to the root JSX element returned from .map()',
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    this.detectTypeScriptViolations(sourceFile).forEach(v => violations.push(v));
    return violations;
  }

  private bodyContainsJSX(node: ts.Node): boolean {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
    let found = false;
    node.forEachChild(child => { if (!found) found = this.bodyContainsJSX(child); });
    return found;
  }

  private bodyHasKeyProp(node: ts.Node): boolean {
    return /\bkey\s*=/.test(node.getText());
  }

  private detectTodoPlaceholders(code: string): Violation[] {
    const violations: Violation[] = [];
    const lines = code.split('\n');

    const incompletePattern = /(?:\/\/|\/\*)\s*(TODO|FIXME|PLACEHOLDER|STUB)\b/i;
    const debtPattern       = /(?:\/\/|\/\*)\s*(HACK|WORKAROUND|KLUDGE|XXX)\b/i;
    const notImplTsPattern  = /throw\s+new\s+(?:Error|TypeError|RangeError)\s*\(\s*['"`](?:not\s+implemented|todo|placeholder|stub)/i;
    const notImplCsPattern  = /throw\s+new\s+NotImplementedException\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      const incompleteMatch = incompletePattern.exec(line);
      if (incompleteMatch) {
        violations.push({
          type: 'todo_placeholder', severity: 'warning',
          message: `${incompleteMatch[1].toUpperCase()} marker at line ${lineNum} — resolve before merging`,
          line: lineNum, fix: 'Replace with the actual implementation'
        });
        continue;
      }

      const debtMatch = debtPattern.exec(line);
      if (debtMatch) {
        violations.push({
          type: 'tech_debt_marker', severity: 'info',
          message: `${debtMatch[1].toUpperCase()} marker at line ${lineNum} — track in your issue tracker`,
          line: lineNum, fix: 'Create a tracking issue and replace with a proper solution'
        });
        continue;
      }

      if (notImplTsPattern.test(line) || notImplCsPattern.test(line)) {
        violations.push({
          type: 'unimplemented_stub', severity: 'error',
          message: `Unimplemented stub at line ${lineNum} — will throw at runtime`,
          line: lineNum, fix: 'Implement the required functionality'
        });
      }
    }

    return violations;
  }
}
