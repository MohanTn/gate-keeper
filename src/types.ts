export type Language = 'csharp' | 'typescript' | 'tsx' | 'jsx';

export interface ArchLayerDef {
  id: string;
  label: string;
  color: string;
  order: number;
}

export interface ArchConnection {
  from: string;
  to: string;
}

export interface ArchMapping {
  version: string;
  layers: ArchLayerDef[];
  connections?: ArchConnection[];
  files: Record<string, string>;      // path → layerId (auto-detected)
  overrides: Record<string, string>;  // path → layerId (user-set, never overwritten)
}

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
  /** Test coverage percentage (0–100). Undefined when no coverage data is available. */
  coveragePercent?: number;
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
  repoRoot?: string;
  definedTypes?: string[];
  layer?: string;
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

// ── Quality Loop Types ─────────────────────────────────────────

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

export interface AttemptLog {
  id: number;
  queueId: number;
  attempt: number;
  ratingBefore: number;
  ratingAfter: number | null;
  violationsFixed: number;
  violationsRemaining: number;
  fixSummary: string | null;
  errorMessage: string | null;
  durationMs: number | null;
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

export interface WorkerResult {
  success: boolean;
  newRating: number;
  ratingBefore: number;
  violationsRemaining: number;
  violationsFixed: number;
  durationMs: number;
  attemptNumber: number;
  fixSummary: string;
  error?: string;
  shouldRetry: boolean;
  workerOutput?: string;
}

export interface QualityLoopConfig {
  threshold: number;
  maxWorkers: number;
  maxAttemptsPerFile: number;
  workerMode: 'cli' | 'api' | 'auto';
  repos: string[];
  excludePatterns: string[];
  checkpointIntervalSec: number;
  heartbeatIntervalSec: number;
}

// ── WebSocket Messages ────────────────────────────────────────

export interface WSMessage {
  type: 'init' | 'update' | 'analysis_complete' | 'error' | 'scan_start' | 'scan_progress' | 'scan_complete' | 'scan_log' | 'repo_list' | 'repo_created' | 'queue_update' | 'queue_progress' | 'worker_activity' | 'trend_update';
  data?: GraphData;
  delta?: { nodes: GraphNode[]; edges: GraphEdge[] };
  analysis?: FileAnalysis;
  error?: string;
  scanTotal?: number;
  scanAnalyzed?: number;
  repos?: RepoMetadata[];
  repo?: RepoMetadata;
  currentRepo?: string;
  logMessage?: string;
  logLevel?: 'info' | 'warn' | 'error';
  logTimestamp?: number;

  // Quality loop messages
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

export interface HookPayload {
  session_id?: string;
  hook_event_name?: 'PostToolUse' | 'PreToolUse' | 'UserPromptSubmit' | 'SessionStart' | 'Stop' | 'session_create' | string;
  tool_name: string;
  cwd?: string;
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
  repoRoot: string;
}

export interface DaemonStatus {
  running: boolean;
  port: number;
  analyzedFiles: number;
  overallRating: number;
}

export interface Config {
  minRating: number;
  scanExcludePatterns?: {
    /** Glob patterns applied to all languages */
    global?: string[];
    /** Glob patterns for C# files (.cs) */
    csharp?: string[];
    /** Glob patterns for TypeScript/JavaScript/React files */
    typescript?: string[];
  };
}

export interface RepoMetadata {
  id: string; // unique ID (e.g., path hash or UUID)
  path: string;
  name: string;
  sessionId?: string;
  sessionType: 'github-copilot' | 'claude' | 'unknown'; // which tool created it
  createdAt: number;
  lastAnalyzedAt?: number;
  fileCount?: number;
  overallRating?: number;
  isActive?: boolean;
}

export interface SessionCreatePayload {
  session_id: string;
  hook_event_name: 'session_create';
  tool_name: string;
  session_info: {
    workspace_path: string;
    git_root?: string;
    session_type: 'github-copilot' | 'claude';
  };
}

export interface RefactoringHint {
  patternName: string;
  violationType: string;
  rationale: string;
  steps: string[];
  estimatedRatingGain: number;
  priority: 'high' | 'medium' | 'low';
}

export interface PatternReport {
  violationType: string;
  severity: 'error' | 'warning' | 'info';
  fileCount: number;
  totalOccurrences: number;
  affectedFiles: string[];
  estimatedRatingGain: number;
  moduleSuggestion: string;
}
