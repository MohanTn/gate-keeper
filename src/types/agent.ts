/**
 * Agent-grade type extensions shared by the MCP envelope, the analyzers, and
 * future remediation planners. Re-exported from src/types.ts for back-compat.
 */

export interface Span {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  offset?: number;
  length?: number;
}

export interface Fix {
  description: string;
  replacement?: string;
  replaceSpan?: Span;
  confidence: 'deterministic' | 'heuristic' | 'manual';
}

export interface RatingBreakdownItem {
  category: string;
  deduction: number;
  detail: string;
  ruleId?: string;
}

export interface AgentResponseEnvelope<T = unknown> {
  version: '1';
  tool: string;
  generatedAt: number;
  data: T;
}

export interface RemediationStep {
  filePath: string;
  ruleId: string;
  span?: Span;
  action: 'replace' | 'insert' | 'delete' | 'manual';
  replacement?: string;
  estimatedRatingGain: number;
  dependencyOrder: number;
}

export interface RemediationPlan {
  rootFile: string;
  blastRadius: { direct: string[]; transitive: string[] };
  steps: RemediationStep[];
  estimatedTotalGain: number;
}
