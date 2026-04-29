"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypeScriptAnalyzer = void 0;
const ts = __importStar(require("typescript"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class TypeScriptAnalyzer {
    analyze(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        const isReact = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
        const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
        const dependencies = this.extractDependencies(sourceFile, filePath);
        const metrics = this.calculateMetrics(sourceFile, content);
        const violations = isReact
            ? this.detectReactViolations(sourceFile)
            : this.detectTypeScriptViolations(sourceFile);
        return { dependencies, metrics, violations };
    }
    extractDependencies(sourceFile, filePath) {
        const deps = [];
        const dir = path.dirname(filePath);
        const visit = (node) => {
            if (ts.isImportDeclaration(node)) {
                const specifier = node.moduleSpecifier.text;
                const resolved = this.resolveModulePath(specifier, dir);
                deps.push({
                    source: filePath,
                    target: resolved ?? specifier,
                    type: 'import',
                    weight: 1
                });
            }
            if (ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === 'require' &&
                node.arguments[0] &&
                ts.isStringLiteral(node.arguments[0])) {
                const specifier = node.arguments[0].text;
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
    resolveModulePath(specifier, fromDir) {
        if (!specifier.startsWith('.'))
            return null;
        const base = path.resolve(fromDir, specifier);
        const exts = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
        for (const ext of exts) {
            if (fs.existsSync(base + ext))
                return base + ext;
        }
        return base;
    }
    calculateMetrics(sourceFile, content) {
        let methodCount = 0;
        let classCount = 0;
        let complexity = 1;
        const visit = (node) => {
            if (ts.isFunctionDeclaration(node) ||
                ts.isArrowFunction(node) ||
                ts.isMethodDeclaration(node) ||
                ts.isFunctionExpression(node)) {
                methodCount++;
            }
            if (ts.isClassDeclaration(node))
                classCount++;
            if (ts.isIfStatement(node) ||
                ts.isWhileStatement(node) ||
                ts.isForStatement(node) ||
                ts.isForInStatement(node) ||
                ts.isForOfStatement(node) ||
                ts.isCaseClause(node) ||
                ts.isConditionalExpression(node) ||
                ts.isCatchClause(node)) {
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
    detectReactViolations(sourceFile) {
        const violations = [];
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
            const duplicateHooks = comp.hooks.filter((h, i, arr) => arr.indexOf(h) !== i && arr.lastIndexOf(h) === i);
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
    extractComponents(sourceFile) {
        const components = [];
        const visit = (node) => {
            // const Foo = () => ... or const Foo = function() ...
            if (ts.isVariableStatement(node)) {
                for (const decl of node.declarationList.declarations) {
                    if (ts.isIdentifier(decl.name) &&
                        this.startsWithUpperCase(decl.name.text) &&
                        decl.initializer &&
                        (ts.isArrowFunction(decl.initializer) ||
                            ts.isFunctionExpression(decl.initializer)) &&
                        this.nodeContainsJSX(decl.initializer)) {
                        const hooks = this.extractHooks(decl.initializer);
                        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                        components.push({ name: decl.name.text, type: 'functional', hooks, line: pos.line + 1 });
                    }
                }
            }
            // function Foo() { ... }
            if (ts.isFunctionDeclaration(node) &&
                node.name &&
                this.startsWithUpperCase(node.name.text) &&
                this.nodeContainsJSX(node)) {
                const hooks = this.extractHooks(node);
                const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                components.push({ name: node.name.text, type: 'functional', hooks, line: pos.line + 1 });
            }
            // class Foo extends React.Component
            if (ts.isClassDeclaration(node) && node.name) {
                const extendsReact = node.heritageClauses?.some(h => h.types.some(t => t.expression.getText().includes('Component') ||
                    t.expression.getText().includes('PureComponent')));
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
    extractHooks(fnNode) {
        const hooks = [];
        const visit = (node) => {
            if (ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                /^use[A-Z]/.test(node.expression.text)) {
                hooks.push(node.expression.text);
            }
            ts.forEachChild(node, visit);
        };
        visit(fnNode);
        return hooks;
    }
    nodeContainsJSX(node) {
        let found = false;
        const visit = (n) => {
            if (found)
                return;
            if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
                found = true;
                return;
            }
            ts.forEachChild(n, visit);
        };
        visit(node);
        return found;
    }
    detectMissingListKeys(sourceFile, violations) {
        const visit = (node) => {
            if (ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === 'map' &&
                node.arguments.length > 0) {
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
    callbackHasKeyProp(node) {
        let found = false;
        const visit = (n) => {
            if (found)
                return;
            if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text === 'key') {
                found = true;
                return;
            }
            ts.forEachChild(n, visit);
        };
        visit(node);
        return found;
    }
    detectInlineHandlers(sourceFile, violations) {
        const visit = (node) => {
            if (ts.isJsxAttribute(node)) {
                const name = node.name.getText();
                if (name.startsWith('on') && node.initializer) {
                    const val = node.initializer;
                    if (ts.isJsxExpression(val) &&
                        val.expression &&
                        (ts.isArrowFunction(val.expression) || ts.isFunctionExpression(val.expression))) {
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
    detectTypeScriptViolations(sourceFile) {
        const violations = [];
        const visit = (node) => {
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
            if (ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                ts.isIdentifier(node.expression.expression) &&
                node.expression.expression.text === 'console' &&
                node.expression.name.text === 'log') {
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
    startsWithUpperCase(name) {
        return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z';
    }
}
exports.TypeScriptAnalyzer = TypeScriptAnalyzer;
//# sourceMappingURL=typescript-analyzer.js.map