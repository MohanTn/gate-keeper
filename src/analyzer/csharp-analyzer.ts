import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Dependency, Metrics, Violation } from '../types';

export interface CSharpAnalysisResult {
  dependencies: Dependency[];
  metrics: Metrics;
  violations: Violation[];
}

export class CSharpAnalyzer {
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
    try {
      execSync('dotnet --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private analyzeWithRoslyn(filePath: string): CSharpAnalysisResult {
    const analyzerPath = path.join(__dirname, '../../CSharpAnalyzer/bin/Release/net8.0/CSharpAnalyzer');
    if (!fs.existsSync(analyzerPath) && !fs.existsSync(analyzerPath + '.exe')) {
      throw new Error('Roslyn analyzer not built');
    }
    const result = execSync(`dotnet "${analyzerPath}" --file "${filePath}" --output json`, {
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
      violations: this.detectViolations(content, lines)
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

    return deps;
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

    return violations;
  }

  private detectGodClass(content: string, lines: string[], violations: Violation[]): void {
    const methodMatches = content.match(/\b(public|private|protected)\s+[\w<>\[\]?]+\s+\w+\s*\(/g) || [];
    if (methodMatches.length > 20) {
      violations.push({
        type: 'god_class',
        severity: 'warning',
        message: `Class has ${methodMatches.length} methods — consider splitting responsibilities (Single Responsibility Principle)`,
        fix: 'Extract related methods into separate focused classes'
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
            violations.push({
              type: 'long_method',
              severity: 'warning',
              message: `Method starting at line ${methodStart + 1} is ${methodLength} lines long — extract logic into smaller methods`,
              line: methodStart + 1,
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
        const lineNum = content.substring(0, match.index).split('\n').length;
        violations.push({
          type: 'tight_coupling',
          severity: 'warning',
          message: `Constructor has ${params.length} parameters — consider using a configuration object or DI container`,
          line: lineNum,
          fix: 'Group related parameters into a settings/options class or use the Builder pattern'
        });
      }
    }
  }

  private detectMagicNumbers(content: string, lines: string[], violations: Violation[]): void {
    const magicNumberRegex = /[^.a-zA-Z_"'](\b(?!0\b|1\b)\d{2,}\b)/g;
    let match: RegExpExecArray | null;

    while ((match = magicNumberRegex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      violations.push({
        type: 'magic_number',
        severity: 'info',
        message: `Magic number ${match[1]} — extract to a named constant`,
        line: lineNum,
        fix: 'Replace with a descriptive constant: const int MaxRetries = ...'
      });
    }
  }

  private detectEmptyCatch(content: string, lines: string[], violations: Violation[]): void {
    const emptyCatchRegex = /catch\s*\([^)]*\)\s*\{\s*\}/g;
    let match: RegExpExecArray | null;

    while ((match = emptyCatchRegex.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      violations.push({
        type: 'empty_catch',
        severity: 'error',
        message: 'Empty catch block silently swallows exceptions',
        line: lineNum,
        fix: 'At minimum, log the exception; consider rethrowing or handling appropriately'
      });
    }
  }
}
