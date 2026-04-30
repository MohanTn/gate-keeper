import * as path from 'path';
import { FileAnalysis, Language } from '../types';
import { TypeScriptAnalyzer } from './typescript-analyzer';
import { CSharpAnalyzer, CSharpAnalysisResult } from './csharp-analyzer';
import { CoverageAnalyzer } from './coverage-analyzer';
import { RatingCalculator } from '../rating/rating-calculator';

const SUPPORTED_EXTENSIONS: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.js': 'typescript',
  '.cs': 'csharp'
};

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
        result.metrics.coveragePercent = coverageResult.coveragePercent;
      }

      const rating = this.ratingCalc.calculate(result.violations, result.metrics, result.dependencies);

      const analysis: FileAnalysis = {
        path: filePath,
        language,
        dependencies: result.dependencies,
        metrics: result.metrics,
        violations: result.violations,
        rating,
        analyzedAt: Date.now()
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
