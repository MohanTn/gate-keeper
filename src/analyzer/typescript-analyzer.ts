import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { Dependency, Metrics, Violation } from '../types';

interface ComponentInfo {
  name: string;
  type: 'functional' | 'class';
  hooks: string[];
  line: number;
}

export interface TypeScriptAnalysisResult {
  dependencies: Dependency[];
  metrics: Metrics;
  violations: Violation[];
}

export class TypeScriptAnalyzer {
  analyze(filePath: string): TypeScriptAnalysisResult {
    const content = fs.readFileSync(filePath, 'utf8');
    const isReact = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');

    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const dependencies = this.extractDependencies(sourceFile, filePath);
    const metrics = this.calculateMetrics(sourceFile, content);
    const violations = isReact
      ? this.detectReactViolations(sourceFile)
      : this.detectTypeScriptViolations(sourceFile);

    violations.push(...this.detectTodoPlaceholders(content));

    return { dependencies, metrics, violations };
  }

  private extractDependencies(sourceFile: ts.SourceFile, filePath: string): Dependency[] {
    const deps: Dependency[] = [];
    const dir = path.dirname(filePath);

    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
        const resolved = this.resolveModulePath(specifier, dir);
        deps.push({
          source: filePath,
          target: resolved ?? specifier,
          type: 'import',
          weight: 1
        });
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const specifier = (node.arguments[0] as ts.StringLiteral).text;
        const resolved = this.resolveModulePath(specifier, dir);
        deps.push({
          source: filePath,
          target: resolved ?? specifier,
          type: 'import',
          weight: 1
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return deps;
  }

  private resolveModulePath(specifier: string, fromDir: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(fromDir, specifier);
    const exts = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
    for (const ext of exts) {
      if (fs.existsSync(base + ext)) return base + ext;
    }
    return base;
  }

  private calculateMetrics(sourceFile: ts.SourceFile, content: string): Metrics {
    let methodCount = 0;
    let classCount = 0;
    let complexity = 1;

    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isFunctionExpression(node)
      ) {
        methodCount++;
      }
      if (ts.isClassDeclaration(node)) classCount++;

      if (
        ts.isIfStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isCaseClause(node) ||
        ts.isConditionalExpression(node) ||
        ts.isCatchClause(node)
      ) {
        complexity++;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      linesOfCode: content.split('\n').length,
      cyclomaticComplexity: complexity,
      numberOfMethods: methodCount,
      numberOfClasses: classCount,
      importCount: sourceFile.statements.filter(ts.isImportDeclaration).length
    };
  }

  private detectReactViolations(sourceFile: ts.SourceFile): Violation[] {
    const violations: Violation[] = [];
    const components = this.extractComponents(sourceFile);

    components.forEach(comp => {
      if (comp.hooks.length > 7) {
        violations.push({
          type: 'hook_overload',
          severity: 'warning',
          message: `${comp.name} has ${comp.hooks.length} hooks — split into custom hooks or smaller components`,
          line: comp.line,
          fix: 'Extract groups of related hooks into a custom hook'
        });
      }

      const duplicateHooks = comp.hooks.filter(
        (h, i, arr) => arr.indexOf(h) !== i && arr.lastIndexOf(h) === i
      );
      if (duplicateHooks.length > 0) {
        violations.push({
          type: 'duplicate_hooks',
          severity: 'warning',
          message: `${comp.name} calls ${duplicateHooks.join(', ')} more than once`,
          line: comp.line,
          fix: 'Merge duplicate hook calls into a single call'
        });
      }
    });

    this.detectMissingListKeys(sourceFile, violations);
    this.detectInlineHandlers(sourceFile, violations);
    this.detectTypeScriptViolations(sourceFile).forEach(v => violations.push(v));

    return violations;
  }

  private extractComponents(sourceFile: ts.SourceFile): ComponentInfo[] {
    const components: ComponentInfo[] = [];

    const visit = (node: ts.Node) => {
      // const Foo = () => ... or const Foo = function() ...
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            this.startsWithUpperCase(decl.name.text) &&
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer)) &&
            this.nodeContainsJSX(decl.initializer)
          ) {
            const hooks = this.extractHooks(decl.initializer);
            const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            components.push({ name: decl.name.text, type: 'functional', hooks, line: pos.line + 1 });
          }
        }
      }

      // function Foo() { ... }
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        this.startsWithUpperCase(node.name.text) &&
        this.nodeContainsJSX(node)
      ) {
        const hooks = this.extractHooks(node);
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        components.push({ name: node.name.text, type: 'functional', hooks, line: pos.line + 1 });
      }

      // class Foo extends React.Component
      if (ts.isClassDeclaration(node) && node.name) {
        const extendsReact = node.heritageClauses?.some(h =>
          h.types.some(
            t =>
              t.expression.getText().includes('Component') ||
              t.expression.getText().includes('PureComponent')
          )
        );
        if (extendsReact) {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          components.push({ name: node.name.text, type: 'class', hooks: [], line: pos.line + 1 });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return components;
  }

  private extractHooks(fnNode: ts.Node): string[] {
    const hooks: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        /^use[A-Z]/.test(node.expression.text)
      ) {
        hooks.push(node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(fnNode);
    return hooks;
  }

  private nodeContainsJSX(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
        found = true;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  private detectMissingListKeys(sourceFile: ts.SourceFile, violations: Violation[]): void {
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'map' &&
        node.arguments.length > 0
      ) {
        const callback = node.arguments[0];
        if (this.nodeContainsJSX(callback) && !this.callbackHasKeyProp(callback)) {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            type: 'missing_key',
            severity: 'error',
            message: 'JSX elements inside .map() are missing the required "key" prop',
            line: pos.line + 1,
            fix: 'Add a unique key prop to each JSX element returned from .map()'
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  private callbackHasKeyProp(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text === 'key') {
        found = true;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  private detectInlineHandlers(sourceFile: ts.SourceFile, violations: Violation[]): void {
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText();
        if (name.startsWith('on') && node.initializer) {
          const val = node.initializer;
          if (
            ts.isJsxExpression(val) &&
            val.expression &&
            (ts.isArrowFunction(val.expression) || ts.isFunctionExpression(val.expression))
          ) {
            const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            violations.push({
              type: 'inline_handler',
              severity: 'info',
              message: `Inline function for "${name}" creates a new reference on every render`,
              line: pos.line + 1,
              fix: 'Extract to a useCallback or a named function outside JSX'
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  private detectTypeScriptViolations(sourceFile: ts.SourceFile): Violation[] {
    const violations: Violation[] = [];

    const visit = (node: ts.Node) => {
      // Explicit `any` usage
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          type: 'any_type',
          severity: 'warning',
          message: 'Avoid the "any" type — use explicit typing or "unknown"',
          line: pos.line + 1
        });
      }

      // console.log usage
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'console' &&
        node.expression.name.text === 'log'
      ) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          type: 'console_log',
          severity: 'info',
          message: 'console.log left in code — remove before merging',
          line: pos.line + 1
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return violations;
  }

  private startsWithUpperCase(name: string): boolean {
    return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z';
  }

  /**
   * Scans raw source text for TODO/FIXME/PLACEHOLDER markers and unimplemented
   * throw stubs. These represent incomplete work that should not pass quality gates.
   *
   * Severity tiers:
   *   error   — throw new Error('Not implemented') — will crash at runtime
   *   warning — TODO / FIXME / PLACEHOLDER / STUB  — incomplete work
   *   info    — HACK / WORKAROUND / KLUDGE          — tracked technical debt
   */
  private detectTodoPlaceholders(content: string): Violation[] {
    const violations: Violation[] = [];
    const lines = content.split('\n');

    const incompletePattern = /(?:\/\/|\/\*)\s*(TODO|FIXME|PLACEHOLDER|STUB)\b/i;
    const debtPattern       = /(?:\/\/|\/\*)\s*(HACK|WORKAROUND|KLUDGE|XXX)\b/i;
    const notImplPattern    = /throw\s+new\s+(?:Error|TypeError|RangeError)\s*\(\s*['"`](?:not\s+implemented|todo|placeholder|stub)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      const incompleteMatch = incompletePattern.exec(line);
      if (incompleteMatch) {
        violations.push({
          type: 'todo_placeholder',
          severity: 'warning',
          message: `${incompleteMatch[1].toUpperCase()} marker at line ${lineNum} — resolve before merging`,
          line: lineNum,
          fix: 'Replace with the actual implementation'
        });
        continue;
      }

      const debtMatch = debtPattern.exec(line);
      if (debtMatch) {
        violations.push({
          type: 'tech_debt_marker',
          severity: 'info',
          message: `${debtMatch[1].toUpperCase()} marker at line ${lineNum} — track in your issue tracker`,
          line: lineNum,
          fix: 'Create a tracking issue and replace with a proper solution'
        });
        continue;
      }

      if (notImplPattern.test(line)) {
        violations.push({
          type: 'unimplemented_stub',
          severity: 'error',
          message: `Unimplemented stub at line ${lineNum} — will throw at runtime`,
          line: lineNum,
          fix: 'Implement the required functionality'
        });
      }
    }

    return violations;
  }
}
