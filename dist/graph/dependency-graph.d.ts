import { FileAnalysis, GraphData } from '../types';
export interface CycleInfo {
    nodes: string[];
}
export declare class DependencyGraph {
    private analyses;
    upsert(analysis: FileAnalysis): void;
    toGraphData(): GraphData;
    detectCycles(): CycleInfo[];
    findHotspots(topN?: number): FileAnalysis[];
    overallRating(): number;
    private basename;
}
//# sourceMappingURL=dependency-graph.d.ts.map