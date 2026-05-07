export type Language = 'csharp' | 'typescript' | 'tsx' | 'jsx';

export interface ArchLayerDef {
  id: string;
  label: string;
  color: string;
  order: number;
}

export interface ArchMapping {
  version: string;
  layers: ArchLayerDef[];
  files: Record<string, string>;      // path → layerId (auto-detected)
  overrides: Record<string, string>;  // path → layerId (user-set, never overwritten)
}

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
  layer?: string;
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
  definedTypes?: string[];
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

export interface RefactoringHint {
  patternName: string;
  violationType: string;
  rationale: string;
  steps: string[];
  estimatedRatingGain: number;
  priority: 'high' | 'medium' | 'low';
}

export interface FileDetailResponse {
  analysis: FileAnalysis;
  ratingBreakdown: RatingBreakdownItem[];
  gitDiff: GitDiffStats | null;
  refactoringHints?: RefactoringHint[];
}

export interface WSMessage {
  type: 'init' | 'update' | 'analysis_complete' | 'error' | 'scan_start' | 'scan_progress' | 'scan_complete' | 'repo_created' | 'repo_list' | 'scan_log';
  data?: GraphData;
  delta?: { nodes: GraphNode[]; edges: GraphEdge[] };
  analysis?: FileAnalysis;
  error?: string;
  scanTotal?: number;
  scanAnalyzed?: number;
  repo?: RepoInfo;
  logMessage?: string;
  logLevel?: 'info' | 'error' | 'warn';
  logTimestamp?: number;
}

export interface RepoInfo {
  repoRoot: string;
  label: string;
  fileCount: number;
  sessionType?: 'claude' | 'github-copilot' | 'unknown';
}

export interface NodePosition {
  nodeId: string;
  x: number;
  y: number;
}

export interface ExcludePattern {
  id: number;
  pattern: string;
  label: string | null;
}

export interface GateKeeperConfig {
  minRating: number;
  scanExcludePatterns?: {
    global?: string[];
    csharp?: string[];
    typescript?: string[];
  };
}

export interface ScanLogEntry {
  message: string;
  level: 'info' | 'error' | 'warn';
  timestamp: number;
}
