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
  type: 'init' | 'update' | 'analysis_complete' | 'error' | 'scan_start' | 'scan_progress' | 'scan_complete' | 'repo_created' | 'repo_list' | 'scan_log' | 'queue_update' | 'queue_progress' | 'worker_activity' | 'trend_update';
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

  // Quality loop
  queueItem?: QueueItem;
  queueStats?: QueueStats;
  queueOverallRating?: number;
  queueDone?: boolean;
  workerAction?: 'start' | 'complete' | 'error';
  workerFilePath?: string;
  workerId?: string;
  workerRating?: number;
  workerSuccess?: boolean;
  workerError?: string;
  trend?: TrendDataPoint;
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

// ── Quality Loop Types ──────────────────────────────────────

export interface QueueItem {
  id: number;
  repo: string;
  filePath: string;
  currentRating: number;
  targetRating: number;
  priorityScore: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  attempts: number;
  maxAttempts: number;
  workerId: string | null;
  lockedAt: number | null;
  errorMessage: string | null;
  completedAt: number | null;
  createdAt: number;
}

export interface QueueStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface TrendDataPoint {
  id: number;
  repo: string;
  overallRating: number;
  filesTotal: number;
  filesPassed: number;
  filesFailed: number;
  filesPending: number;
  recordedAt: number;
}

export interface AttemptLog {
  id: number;
  queue_id: number;
  attempt: number;
  rating_before: number;
  rating_after: number | null;
  violations_fixed: number;
  violations_remaining: number;
  fix_summary: string | null;
  error_message: string | null;
  duration_ms: number | null;
  worker_output: string | null;
  created_at: number;
}
