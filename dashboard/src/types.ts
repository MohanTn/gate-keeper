export type Language = 'csharp' | 'typescript' | 'tsx' | 'jsx';

export interface Violation {
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  fix?: string;
}

export interface Metrics {
  linesOfCode: number;
  cyclomaticComplexity: number;
  numberOfMethods: number;
  numberOfClasses: number;
  importCount: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: Language;
  rating: number;
  size: number;
  violations: Violation[];
  metrics: Metrics;
  // force-graph runtime fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  strength: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FileAnalysis {
  path: string;
  language: Language;
  rating: number;
  violations: Violation[];
  metrics: Metrics;
}

export interface RatingBreakdownItem {
  category: string;
  deduction: number;
  detail: string;
}

export interface GitDiffStats {
  added: number;
  removed: number;
}

export interface FileDetailResponse {
  analysis: FileAnalysis;
  ratingBreakdown: RatingBreakdownItem[];
  gitDiff: GitDiffStats | null;
}

export interface WSMessage {
  type: 'init' | 'update' | 'analysis_complete' | 'error' | 'scan_start' | 'scan_complete';
  data?: GraphData;
  delta?: { nodes: GraphNode[]; edges: GraphEdge[] };
  analysis?: FileAnalysis;
  error?: string;
  scanTotal?: number;
  scanAnalyzed?: number;
}

export interface RepoInfo {
  repoRoot: string;
  label: string;
  fileCount: number;
}

export interface NodePosition {
  nodeId: string;
  x: number;
  y: number;
}
