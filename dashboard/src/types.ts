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

export interface WSMessage {
  type: 'init' | 'update' | 'analysis_complete' | 'error';
  data?: GraphData;
  delta?: { nodes: GraphNode[]; edges: GraphEdge[] };
  analysis?: FileAnalysis;
  error?: string;
}
