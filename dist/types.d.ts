export type Language = 'csharp' | 'typescript' | 'tsx' | 'jsx';
export interface Dependency {
    source: string;
    target: string;
    type: 'import' | 'inheritance' | 'composition' | 'usage';
    weight: number;
}
export interface Metrics {
    linesOfCode: number;
    cyclomaticComplexity: number;
    numberOfMethods: number;
    numberOfClasses: number;
    importCount: number;
}
export interface Violation {
    type: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    line?: number;
    fix?: string;
}
export interface FileAnalysis {
    path: string;
    language: Language;
    dependencies: Dependency[];
    metrics: Metrics;
    violations: Violation[];
    rating: number;
    analyzedAt: number;
}
export interface GraphNode {
    id: string;
    label: string;
    type: Language;
    rating: number;
    size: number;
    violations: Violation[];
    metrics: Metrics;
}
export interface GraphEdge {
    source: string;
    target: string;
    type: string;
    strength: number;
}
export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}
export interface WSMessage {
    type: 'init' | 'update' | 'analysis_complete' | 'error';
    data?: GraphData;
    delta?: {
        nodes: GraphNode[];
        edges: GraphEdge[];
    };
    analysis?: FileAnalysis;
    error?: string;
}
export interface HookPayload {
    session_id?: string;
    hook_event_name?: string;
    tool_name: string;
    tool_input: {
        file_path?: string;
        path?: string;
        old_string?: string;
        new_string?: string;
        content?: string;
    };
}
export interface DaemonRequest {
    filePath: string;
}
export interface DaemonStatus {
    running: boolean;
    port: number;
    analyzedFiles: number;
    overallRating: number;
}
//# sourceMappingURL=types.d.ts.map