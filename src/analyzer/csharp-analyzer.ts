import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Dependency, Metrics, Span, Violation } from '../types';

const RULE_ID_MAP: Record<string, string> = {
  god_class: 'cs/god-class',
  long_method: 'cs/long-method',
  tight_coupling: 'cs/tight-coupling',
  magic_number: 'cs/magic-number',
  empty_catch: 'cs/empty-catch',
  todo_placeholder: 'cs/no-todo',
  tech_debt_marker: 'cs/tech-debt',
  unimplemented_stub: 'cs/no-stub',
};

function offsetToSpan(content: string, offset: number, length: number): Span {
  const before = content.substring(0, offset);
  const linesBefore = before.split('\n');
  const line = linesBefore.length;
  const column = linesBefore[linesBefore.length - 1].length + 1;
  const matchText = content.substring(offset, offset + length);
  const matchLines = matchText.split('\n');
  const endLine = line + matchLines.length - 1;
  const endColumn = matchLines.length === 1
    ? column + length
    : matchLines[matchLines.length - 1].length + 1;
  return { line, column, endLine, endColumn, offset, length };
}

function lineSpan(line: number, column: number, length: number): Span {
  return { line, column, endLine: line, endColumn: column + length };
}

export interface CSharpAnalysisResult {
  dependencies: Dependency[];
  metrics: Metrics;
  violations: Violation[];
  definedTypes: string[];
}

export class CSharpAnalyzer {
  private dotnetAvailable: boolean | null = null;

  analyze(filePath: string): CSharpAnalysisResult {
    // Try Roslyn CLI analyzer first (if dotnet is available)
    if (this.isDotNetAvailable()) {
      try {
        return this.analyzeWithRoslyn(filePath);
      } catch {
        // Fall through to text-based analysis
      }
    }
    return this.analyzeWithText(filePath);
  }

  private isDotNetAvailable(): boolean {
    if (this.dotnetAvailable !== null) return this.dotnetAvailable;
    try {
      execSync('dotnet --version', { stdio: 'ignore' });
      this.dotnetAvailable = true;
    } catch {
      this.dotnetAvailable = false;
    }
    return this.dotnetAvailable;
  }

  private analyzeWithRoslyn(filePath: string): CSharpAnalysisResult {
    const dllPath = path.join(__dirname, '../../CSharpAnalyzer/bin/Release/net8.0/CSharpAnalyzer.dll');
    if (!fs.existsSync(dllPath)) {
      throw new Error('Roslyn analyzer not built — run: dotnet build CSharpAnalyzer -c Release');
    }
    const result = execSync(`dotnet "${dllPath}" --file "${filePath}"`, {
      encoding: 'utf8',
      timeout: 10000
    });
    return JSON.parse(result) as CSharpAnalysisResult;
  }

  private analyzeWithText(filePath: string): CSharpAnalysisResult {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    return {
      dependencies: this.extractUsings(content, filePath),
      metrics: this.calculateMetrics(content, lines),
      violations: this.detectViolations(content, lines),
      definedTypes: this.extractDefinedTypes(content),
    };
  }

  private extractUsings(content: string, filePath: string): Dependency[] {
    const deps: Dependency[] = [];
    const usingRegex = /^using\s+([\w.]+);/gm;
    let match: RegExpExecArray | null;

    while ((match = usingRegex.exec(content)) !== null) {
      deps.push({
        source: filePath,
        target: match[1],
        type: 'import',
        weight: 1
      });
    }

    // Extract type references: base classes, interfaces, field types, parameter types, generic args
    const typeRefs = this.extractTypeReferences(content);
    for (const typeName of typeRefs) {
      deps.push({
        source: filePath,
        target: `__type__:${typeName}`,
        type: 'usage',
        weight: 1
      });
    }

    return deps;
  }

  /** Extract class/interface/struct/enum/record names defined in this file */
  private extractDefinedTypes(content: string): string[] {
    const types: string[] = [];
    // Match: [access] [partial] class/interface/struct/enum/record Name<T>
    const typeDefRegex = /\b(?:public|internal|private|protected)?\s*(?:static\s+)?(?:partial\s+)?(?:abstract\s+)?(?:sealed\s+)?(?:class|interface|struct|enum|record)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = typeDefRegex.exec(content)) !== null) {
      types.push(match[1]);
    }
    return [...new Set(types)];
  }

  /** Extract type names referenced (used) in this file — for cross-file edges */
  private extractTypeReferences(content: string): string[] {
    const refs = new Set<string>();

    // Strip comments and strings for cleaner matching
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    // 1. Inheritance / interface implementation: class Foo : Bar, IBaz
    const inheritRegex = /\b(?:class|struct|record)\s+\w+(?:<[^>]+>)?\s*:\s*([^{]+)/g;
    let match: RegExpExecArray | null;
    while ((match = inheritRegex.exec(cleaned)) !== null) {
      const bases = match[1].split(',').map(s => s.trim().replace(/<.*>$/, ''));
      for (const base of bases) {
        const name = base.split('.').pop()?.replace(/\s+where\s+.*/, '').trim();
        if (name && /^[A-Z]\w{1,}$/.test(name)) refs.add(name);
      }
    }

    // 2. Field / property / variable declarations: TypeName varName
    const fieldRegex = /\b(?:public|private|protected|internal|static|readonly|virtual|override|abstract|async)\s+(?:static\s+|readonly\s+|virtual\s+|override\s+|abstract\s+|async\s+)*([A-Z]\w+(?:<[^>]+>)?)\s+\w+\s*[{;=,)]/g;
    while ((match = fieldRegex.exec(cleaned)) !== null) {
      const typeName = match[1].replace(/<.*>$/, '').trim();
      if (typeName && /^[A-Z]\w{1,}$/.test(typeName) && !isBuiltinType(typeName)) {
        refs.add(typeName);
      }
      // Also capture generic type args
      const generics = match[1].match(/<(.+)>/);
      if (generics) {
        for (const g of generics[1].split(',')) {
          const gName = g.trim().replace(/<.*>$/, '');
          if (/^[A-Z]\w{1,}$/.test(gName) && !isBuiltinType(gName)) refs.add(gName);
        }
      }
    }

    // 3. Method parameters and return types
    const methodSigRegex = /\b(?:public|private|protected|internal|static|virtual|override|abstract|async)\s+(?:static\s+|virtual\s+|override\s+|abstract\s+|async\s+)*([A-Z]\w+(?:<[^>]+>)?)\s+\w+\s*\(([^)]*)\)/g;
    while ((match = methodSigRegex.exec(cleaned)) !== null) {
      // Return type
      const retType = match[1].replace(/<.*>$/, '').trim();
      if (/^[A-Z]\w{1,}$/.test(retType) && !isBuiltinType(retType)) refs.add(retType);
      // Parameter types
      const params = match[2];
      if (params) {
        const paramTypeRegex = /([A-Z]\w+(?:<[^>]+>)?)\s+\w+/g;
        let pm: RegExpExecArray | null;
        while ((pm = paramTypeRegex.exec(params)) !== null) {
          const pType = pm[1].replace(/<.*>$/, '').trim();
          if (/^[A-Z]\w{1,}$/.test(pType) && !isBuiltinType(pType)) refs.add(pType);
        }
      }
    }

    // 4. new TypeName(...)
    const newRegex = /new\s+([A-Z]\w+)\s*[(<{]/g;
    while ((match = newRegex.exec(cleaned)) !== null) {
      if (!isBuiltinType(match[1])) refs.add(match[1]);
    }

    // 5. typeof(TypeName), nameof(TypeName), as TypeName, is TypeName
    const castRegex = /\b(?:typeof|nameof|as|is)\s*\(?\s*([A-Z]\w+)/g;
    while ((match = castRegex.exec(cleaned)) !== null) {
      if (!isBuiltinType(match[1])) refs.add(match[1]);
    }

    // 6. Attribute usage: [AttributeName] or [AttributeName(...)]
    const attrRegex = /\[\s*([A-Z]\w+)\s*(?:\(|])/g;
    while ((match = attrRegex.exec(cleaned)) !== null) {
      if (!isBuiltinType(match[1])) refs.add(match[1]);
    }

    // Remove types defined in this same file
    const definedHere = this.extractDefinedTypes(content);
    for (const d of definedHere) refs.delete(d);

    return [...refs];
  }

  private calculateMetrics(content: string, lines: string[]): Metrics {
    const methodRegex = /\b(public|private|protected|internal|static)\s+[\w<>\[\]?]+\s+\w+\s*\(/g;
    const classRegex = /\b(class|interface|struct|record)\s+\w+/g;
    const complexityRegex = /\b(if|else if|while|for|foreach|case|catch|\?)\b/g;

    const methods = (content.match(methodRegex) || []).length;
    const classes = (content.match(classRegex) || []).length;
    const complexity = 1 + (content.match(complexityRegex) || []).length;
    const usingCount = (content.match(/^using\s+/gm) || []).length;

    return {
      linesOfCode: lines.length,
      cyclomaticComplexity: complexity,
      numberOfMethods: methods,
      numberOfClasses: classes,
      importCount: usingCount
    };
  }

  private detectViolations(content: string, lines: string[]): Violation[] {
    const violations: Violation[] = [];

    this.detectGodClass(content, lines, violations);
    this.detectLongMethods(content, lines, violations);
    this.detectTightCoupling(content, lines, violations);
    this.detectMagicNumbers(content, lines, violations);
    this.detectEmptyCatch(content, lines, violations);
    this.detectTodoPlaceholders(lines, violations);

    return violations;
  }

  private detectTodoPlaceholders(lines: string[], violations: Violation[]): void {
    const incompletePattern = /(?:\/\/|\/\*)\s*(TODO|FIXME|PLACEHOLDER|STUB)\b/i;
    const debtPattern       = /(?:\/\/|\/\*)\s*(HACK|WORKAROUND|KLUDGE|XXX)\b/i;
    const notImplPattern    = /throw\s+new\s+NotImplementedException\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      const incompleteMatch = incompletePattern.exec(line);
      if (incompleteMatch) {
        violations.push({
          type: 'todo_placeholder',
          ruleId: RULE_ID_MAP.todo_placeholder,
          severity: 'warning',
          message: `${incompleteMatch[1].toUpperCase()} marker at line ${lineNum} — resolve before merging`,
          line: lineNum,
          span: lineSpan(lineNum, (incompleteMatch.index ?? 0) + 1, incompleteMatch[0].length),
          fix: 'Replace with the actual implementation'
        });
        continue;
      }

      const debtMatch = debtPattern.exec(line);
      if (debtMatch) {
        violations.push({
          type: 'tech_debt_marker',
          ruleId: RULE_ID_MAP.tech_debt_marker,
          severity: 'info',
          message: `${debtMatch[1].toUpperCase()} marker at line ${lineNum} — track in your issue tracker`,
          line: lineNum,
          span: lineSpan(lineNum, (debtMatch.index ?? 0) + 1, debtMatch[0].length),
          fix: 'Create a tracking issue and replace with a proper solution'
        });
        continue;
      }

      const stubMatch = notImplPattern.exec(line);
      if (stubMatch) {
        violations.push({
          type: 'unimplemented_stub',
          ruleId: RULE_ID_MAP.unimplemented_stub,
          severity: 'error',
          message: `Unimplemented stub at line ${lineNum} — NotImplementedException will throw at runtime`,
          line: lineNum,
          span: lineSpan(lineNum, (stubMatch.index ?? 0) + 1, stubMatch[0].length),
          fix: 'Implement the required functionality'
        });
      }
    }
  }

  private detectGodClass(content: string, lines: string[], violations: Violation[]): void {
    const methodMatches = content.match(/\b(public|private|protected)\s+[\w<>\[\]?]+\s+\w+\s*\(/g) || [];
    if (methodMatches.length > 20) {
      // Anchor at the first class/struct/record/interface declaration; fall back to file start.
      const declMatch = /\b(class|struct|record|interface)\s+\w+/.exec(content);
      const span = declMatch
        ? offsetToSpan(content, declMatch.index, declMatch[0].length)
        : lineSpan(1, 1, 1);
      violations.push({
        type: 'god_class',
        ruleId: RULE_ID_MAP.god_class,
        severity: 'warning',
        message: `Class has ${methodMatches.length} methods — consider splitting responsibilities (Single Responsibility Principle)`,
        line: span.line,
        span,
        fix: 'Extract related methods into separate focused classes (structural — review whole class)'
      });
    }
  }

  private detectLongMethods(content: string, lines: string[], violations: Violation[]): void {
    // Find method boundaries using brace counting
    let methodStart = -1;
    let braceDepth = 0;
    let inMethod = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const methodMatch = line.match(/\b(public|private|protected|internal)\s+[\w<>\[\]?]+\s+\w+\s*\(/);

      if (methodMatch && !inMethod) {
        methodStart = i;
        inMethod = true;
        braceDepth = 0;
      }

      if (inMethod) {
        braceDepth += (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;

        if (braceDepth === 0 && i > methodStart) {
          const methodLength = i - methodStart;
          if (methodLength > 50) {
            const startCol = lines[methodStart].search(/\S/) + 1 || 1;
            violations.push({
              type: 'long_method',
              ruleId: RULE_ID_MAP.long_method,
              severity: 'warning',
              message: `Method starting at line ${methodStart + 1} is ${methodLength} lines long — extract logic into smaller methods`,
              line: methodStart + 1,
              span: {
                line: methodStart + 1,
                column: startCol,
                endLine: i + 1,
                endColumn: (lines[i]?.length ?? 0) + 1,
              },
              fix: 'Extract cohesive logic blocks into private helper methods'
            });
          }
          inMethod = false;
        }
      }
    }
  }

  private detectTightCoupling(content: string, lines: string[], violations: Violation[]): void {
    // Detect constructors with too many parameters (indicates tight coupling)
    const ctorRegex = /public\s+\w+\s*\(([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = ctorRegex.exec(content)) !== null) {
      const params = match[1].split(',').filter(p => p.trim().length > 0);
      if (params.length > 5) {
        const span = offsetToSpan(content, match.index, match[0].length);
        violations.push({
          type: 'tight_coupling',
          ruleId: RULE_ID_MAP.tight_coupling,
          severity: 'warning',
          message: `Constructor has ${params.length} parameters — consider using a configuration object or DI container`,
          line: span.line,
          span,
          fix: 'Group related parameters into a settings/options class or use the Builder pattern'
        });
      }
    }
  }

  private detectMagicNumbers(content: string, lines: string[], violations: Violation[]): void {
    const magicNumberRegex = /[^.a-zA-Z_"'](\b(?!0\b|1\b)\d{2,}\b)/g;
    let match: RegExpExecArray | null;

    while ((match = magicNumberRegex.exec(content)) !== null) {
      // Magic number capture is match[1]; locate it relative to match.index.
      const numberOffset = match.index + match[0].indexOf(match[1]);
      const span = offsetToSpan(content, numberOffset, match[1].length);
      violations.push({
        type: 'magic_number',
        ruleId: RULE_ID_MAP.magic_number,
        severity: 'info',
        message: `Magic number ${match[1]} — extract to a named constant`,
        line: span.line,
        span,
        fix: 'Replace with a descriptive constant: const int MaxRetries = ...'
      });
    }
  }

  private detectEmptyCatch(content: string, lines: string[], violations: Violation[]): void {
    const emptyCatchRegex = /catch\s*\([^)]*\)\s*\{\s*\}/g;
    let match: RegExpExecArray | null;

    while ((match = emptyCatchRegex.exec(content)) !== null) {
      const span = offsetToSpan(content, match.index, match[0].length);
      violations.push({
        type: 'empty_catch',
        ruleId: RULE_ID_MAP.empty_catch,
        severity: 'error',
        message: 'Empty catch block silently swallows exceptions',
        line: span.line,
        span,
        fix: 'At minimum, log the exception; consider rethrowing or handling appropriately'
      });
    }
  }
}

/** Common C# / .NET built-in type names to exclude from dependency detection */
function isBuiltinType(name: string): boolean {
  const builtins = new Set([
    'String', 'Int32', 'Int64', 'Boolean', 'Byte', 'Char', 'Decimal', 'Double', 'Float',
    'Single', 'Object', 'Void', 'DateTime', 'DateTimeOffset', 'TimeSpan', 'Guid',
    'Task', 'ValueTask', 'List', 'Dictionary', 'HashSet', 'IEnumerable', 'IList',
    'IDictionary', 'ICollection', 'IQueryable', 'ILogger', 'IConfiguration',
    'CancellationToken', 'Exception', 'ArgumentException', 'ArgumentNullException',
    'InvalidOperationException', 'NotImplementedException', 'NotSupportedException',
    'Action', 'Func', 'Predicate', 'EventHandler', 'Nullable', 'Lazy',
    'Console', 'Math', 'Convert', 'Enumerable', 'StringBuilder', 'Regex',
    'File', 'Path', 'Directory', 'Stream', 'StreamReader', 'StreamWriter',
    'HttpClient', 'HttpContext', 'HttpRequest', 'HttpResponse',
    'JsonSerializer', 'JsonConvert', 'JObject', 'JArray', 'JToken',
    'IServiceProvider', 'IServiceCollection', 'IHostEnvironment', 'IWebHostEnvironment',
    'Assert', 'Fact', 'Theory', 'Test', 'TestFixture', 'SetUp', 'TearDown',
    'Migration', 'MigrationBuilder', 'OperationBuilder', 'ColumnBuilder', 'CreateTableBuilder',
    'DbContext', 'DbSet', 'ModelBuilder', 'EntityTypeBuilder',
  ]);
  return builtins.has(name);
}
