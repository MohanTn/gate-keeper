import { Dependency, Metrics, Violation } from '../types';
export interface CSharpAnalysisResult {
    dependencies: Dependency[];
    metrics: Metrics;
    violations: Violation[];
}
export declare class CSharpAnalyzer {
    analyze(filePath: string): CSharpAnalysisResult;
    private isDotNetAvailable;
    private analyzeWithRoslyn;
    private analyzeWithText;
    private extractUsings;
    private calculateMetrics;
    private detectViolations;
    private detectGodClass;
    private detectLongMethods;
    private detectTightCoupling;
    private detectMagicNumbers;
    private detectEmptyCatch;
}
//# sourceMappingURL=csharp-analyzer.d.ts.map