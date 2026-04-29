import { Dependency, Metrics, Violation } from '../types';
export interface TypeScriptAnalysisResult {
    dependencies: Dependency[];
    metrics: Metrics;
    violations: Violation[];
}
export declare class TypeScriptAnalyzer {
    analyze(filePath: string): TypeScriptAnalysisResult;
    private extractDependencies;
    private resolveModulePath;
    private calculateMetrics;
    private detectReactViolations;
    private extractComponents;
    private extractHooks;
    private nodeContainsJSX;
    private detectMissingListKeys;
    private callbackHasKeyProp;
    private detectInlineHandlers;
    private detectTypeScriptViolations;
    private startsWithUpperCase;
}
//# sourceMappingURL=typescript-analyzer.d.ts.map