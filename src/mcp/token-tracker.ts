/**
 * Session-scoped token savings tracker.
 *
 * Maintains an in-memory tally of graph queries made and estimated tokens
 * saved vs. the naive "read every affected file" approach. The MCP server
 * exposes this via get_session_metrics so agents can report efficiency.
 */

export interface QueryRecord {
  tool: string;
  filesNotRead: number;
  estimatedSavedTokens: number;
  responseTokens: number;
  timestamp: number;
}

export interface SessionMetrics {
  totalQueries: number;
  totalFilesNotRead: number;
  estimatedSavedTokens: number;
  estimatedNaiveTokens: number;
  savingsPercent: number;
  queries: QueryRecord[];
}

const AVG_FILE_TOKENS = 5000;

export interface ContextBudget {
  totalQueries: number;
  totalFilesNotRead: number;
  estimatedNaiveTokens: number;
  actualResponseTokens: number;
  savingsPercent: number;
  savingsTokens: number;
  perTool: Array<{ tool: string; calls: number; filesAvoided: number; tokensSaved: number }>;
  recommendations: string[];
}

class TokenTracker {
  private records: QueryRecord[] = [];

  record(tool: string, filesNotRead: number, responseText: string): void {
    const responseTokens = Math.ceil(responseText.length / 4);
    this.records.push({
      tool,
      filesNotRead,
      estimatedSavedTokens: filesNotRead * AVG_FILE_TOKENS - responseTokens,
      responseTokens,
      timestamp: Date.now(),
    });
  }

  getMetrics(): SessionMetrics {
    const totalFilesNotRead = this.records.reduce((s, r) => s + r.filesNotRead, 0);
    const estimatedNaiveTokens = totalFilesNotRead * AVG_FILE_TOKENS;
    const estimatedSavedTokens = this.records.reduce(
      (s, r) => s + Math.max(0, r.estimatedSavedTokens), 0
    );
    const savingsPercent = estimatedNaiveTokens > 0
      ? Math.round((estimatedSavedTokens / estimatedNaiveTokens) * 100)
      : 0;

    return {
      totalQueries: this.records.length,
      totalFilesNotRead,
      estimatedSavedTokens,
      estimatedNaiveTokens,
      savingsPercent,
      queries: [...this.records],
    };
  }

  /** Richer budget breakdown with per-tool stats and recommendations. */
  getContextBudget(): ContextBudget {
    const totalFilesNotRead = this.records.reduce((s, r) => s + r.filesNotRead, 0);
    const actualResponseTokens = this.records.reduce((s, r) => s + r.responseTokens, 0);
    const estimatedNaiveTokens = totalFilesNotRead * AVG_FILE_TOKENS;
    const savingsTokens = Math.max(0, estimatedNaiveTokens - actualResponseTokens);
    const savingsPercent = estimatedNaiveTokens > 0
      ? Math.round((savingsTokens / estimatedNaiveTokens) * 100)
      : 0;

    // Per-tool breakdown
    const perToolMap = new Map<string, { calls: number; filesAvoided: number; tokensSaved: number }>();
    for (const r of this.records) {
      const entry = perToolMap.get(r.tool) ?? { calls: 0, filesAvoided: 0, tokensSaved: 0 };
      entry.calls++;
      entry.filesAvoided += r.filesNotRead;
      entry.tokensSaved += Math.max(0, r.estimatedSavedTokens);
      perToolMap.set(r.tool, entry);
    }
    const perTool = [...perToolMap.entries()]
      .map(([tool, v]) => ({ tool, ...v }))
      .sort((a, b) => b.tokensSaved - a.tokensSaved);

    // Generate recommendations
    const recommendations: string[] = [];
    if (totalFilesNotRead > 0) {
      recommendations.push(
        `You avoided reading ~${totalFilesNotRead} files using the graph (~${savingsPercent}% token reduction).`
      );
    }
    if (this.records.length > 0) {
      const mostUsed = perTool[0];
      if (mostUsed) {
        recommendations.push(
          `Most effective tool: \`${mostUsed.tool}\` saved ~${mostUsed.tokensSaved.toLocaleString()} tokens across ${mostUsed.calls} calls.`
        );
      }
    }
    if (recommendations.length === 0) {
      recommendations.push('No graph queries yet. Try `get_impact_set`, `trace_path`, or `summarize_file`.');
    }

    return {
      totalQueries: this.records.length,
      totalFilesNotRead,
      estimatedNaiveTokens,
      actualResponseTokens,
      savingsPercent,
      savingsTokens,
      perTool,
      recommendations,
    };
  }

  reset(): void {
    this.records = [];
  }
}

// Singleton shared across the MCP session
export const tokenTracker = new TokenTracker();
