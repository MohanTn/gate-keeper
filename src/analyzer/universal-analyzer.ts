import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { FileAnalysis, Language, Violation } from '../types';
import { TypeScriptAnalyzer } from './typescript-analyzer';
import { CSharpAnalyzer, CSharpAnalysisResult } from './csharp-analyzer';
import { CoverageAnalyzer } from './coverage-analyzer';
import { RatingCalculator } from '../rating/rating-calculator';

const ANALYZER_VERSION = '2.0';
const SEVERITY_WEIGHT: Record<Violation['severity'], number> = {
  error: 1.5,
  warning: 0.5,
  info: 0.1,
};

function priorityFor(v: Violation): number {
  const weight = SEVERITY_WEIGHT[v.severity] ?? 0.1;
  const isDeterministic =
    typeof v.fix === 'object' && v.fix?.confidence === 'deterministic';
  return weight / (isDeterministic ? 1 : 3);
}

const SUPPORTED_EXTENSIONS: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.js': 'typescript',
  '.cs': 'csharp'
};

function enrichCodeSnippets(violations: Violation[], filePath: string): void {
  const withSpans = violations.some(v => v.span);
  if (!withSpans) return;
  let lines: string[];
  try {
    lines = fs.readFileSync(filePath, 'utf8').split('\n');
  } catch {
    return;
  }
  for (const v of violations) {
    if (!v.span || v.codeSnippet) continue;
    const start = Math.max(0, v.span.line - 2);
    const end = Math.min(lines.length, v.span.endLine + 1);
    v.codeSnippet = lines.slice(start, end).join('\n');
  }
}

export class UniversalAnalyzer {
  private tsAnalyzer = new TypeScriptAnalyzer();
  private csAnalyzer = new CSharpAnalyzer();
  private coverageAnalyzer = new CoverageAnalyzer();
  private ratingCalc = new RatingCalculator();

  isSupportedFile(filePath: string): boolean {
    return path.extname(filePath) in SUPPORTED_EXTENSIONS;
  }

  async analyze(filePath: string): Promise<FileAnalysis | null> {
    const ext = path.extname(filePath);
    const language = SUPPORTED_EXTENSIONS[ext];
    if (!language) return null;

    try {
      const result =
        language === 'csharp'
          ? this.csAnalyzer.analyze(filePath)
          : this.tsAnalyzer.analyze(filePath);

      // Check test coverage and merge violations
      const coverageResult = await this.coverageAnalyzer.checkCoverage(filePath);
      if (coverageResult) {
        result.violations.push(...coverageResult.violations);
        // Only set coveragePercent when it was actually measured — undefined means
        // no test file exists, so the metric-based coverage penalty is skipped and
        // the violation-based penalty (no_test_file / hollow_test_file) applies instead.
        if (coverageResult.coveragePercent !== undefined) {
          result.metrics.coveragePercent = coverageResult.coveragePercent;
        }
      }

      enrichCodeSnippets(result.violations, filePath);

      for (const v of result.violations) {
        v.priorityScore = priorityFor(v);
      }
      result.violations.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

      const { rating, breakdown } = this.ratingCalc.calculateWithBreakdown(
        result.violations,
        result.metrics,
        result.dependencies
      );

      let fileHash: string | undefined;
      try {
        fileHash = crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
      } catch {
        fileHash = undefined;
      }

      const analysis: FileAnalysis = {
        path: filePath,
        language,
        dependencies: result.dependencies,
        metrics: result.metrics,
        violations: result.violations,
        rating,
        analyzedAt: Date.now(),
        ratingBreakdown: breakdown,
        fileHash,
        analyzerVersion: ANALYZER_VERSION,
      };

      // Attach defined types for C# files (used for cross-file dependency resolution)
      if (language === 'csharp' && 'definedTypes' in result) {
        analysis.definedTypes = (result as CSharpAnalysisResult).definedTypes;
      }

      return analysis;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        path: filePath,
        language,
        dependencies: [],
        metrics: { linesOfCode: 0, cyclomaticComplexity: 0, numberOfMethods: 0, numberOfClasses: 0, importCount: 0 },
        violations: [{ type: 'analysis_error', severity: 'error', message: `Analysis failed: ${message}` }],
        rating: 5,
        analyzedAt: Date.now()
      };
    }
  }
}
