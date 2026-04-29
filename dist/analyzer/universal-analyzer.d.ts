import { FileAnalysis } from '../types';
export declare class UniversalAnalyzer {
    private tsAnalyzer;
    private csAnalyzer;
    private ratingCalc;
    isSupportedFile(filePath: string): boolean;
    analyze(filePath: string): Promise<FileAnalysis | null>;
}
//# sourceMappingURL=universal-analyzer.d.ts.map