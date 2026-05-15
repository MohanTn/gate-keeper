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
  /** Test coverage percentage (0–100). Undefined when no coverage data is available. */
  coveragePercent?: number;
}

export {
  Span,
  Fix,
  RatingBreakdownItem,
  AgentResponseEnvelope,
  RemediationStep,
  RemediationPlan,
} from './types/agent';
import { Span, Fix, RatingBreakdownItem } from './types/agent';

export interface Violation {
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  fix?: Fix | string;
  ruleId?: string;
  span?: Span;
  codeSnippet?: string;
  priorityScore?: number;
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
  ratingBreakdown?: RatingBreakdownItem[];
  fileHash?: string;
  analyzerVersion?: string;
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

// ── WebSocket Messages ────────────────────────────────────────

export interface WSMessage {
  type: 'init' | 'update' | 'analysis_complete' | 'error' | 'scan_start' | 'scan_progress' | 'scan_complete' | 'scan_log' | 'repo_list' | 'repo_created';
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
