/**
 * MCP Tool Handlers — barrel module
 *
 * Re-exports all handler functions from domain sub-modules and provides
 * the tool-call router used by the JSON-RPC message handler.
 */

import { text, McpResponse } from './shared';
import {
  handleAnalyzeFile,
  handleAnalyzeCode,
  handleAnalyzeMany,
  handleCodebaseHealth,
  handleQualityRules,
} from './analysis';
import {
  handleFileContext,
  handleDependencyGraph,
} from './graph';
import {
  handleImpactAnalysis,
  handlePredictImpactWithRemediation,
} from './impact';
import {
  handleSuggestRefactoring,
  handleViolationPatterns,
} from './improvement';
import {
  handleGetImpactSet,
  handleGetCentralityRank,
  handleTracePath,
  handleSummarizeFile,
  handleFindCallers,
  handleCheckPreEditSafety,
  handleGetSessionMetrics,
} from './graph-query';
import {
  handleGetGraphReport,
  handleQueryGraph,
  handleExplainNode,
  handleExportGraph,
  handleMergeGraphs,
  handleGetGraphViz,
} from './graph-intelligence';
import {
  handleInstallPlatform,
  handleInstallGitHooks,
} from './platform-installer';
import { handlePRReview } from './pr-review';

export { text };
export {
  handleAnalyzeFile,
  handleAnalyzeCode,
  handleAnalyzeMany,
  handleCodebaseHealth,
  handleQualityRules,
};
export {
  handleFileContext,
  handleDependencyGraph,
};
export {
  handleImpactAnalysis,
  handlePredictImpactWithRemediation,
};
export {
  handleSuggestRefactoring,
  handleViolationPatterns,
};
export {
  handleGetImpactSet,
  handleGetCentralityRank,
  handleTracePath,
  handleSummarizeFile,
  handleFindCallers,
  handleCheckPreEditSafety,
  handleGetSessionMetrics,
};
export {
  handleGetGraphReport,
  handleQueryGraph,
  handleExplainNode,
  handleExportGraph,
  handleMergeGraphs,
  handleGetGraphViz,
};
export { handleInstallPlatform, handleInstallGitHooks };
export { handlePRReview };

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  switch (name) {
    case 'analyze_file':
      return handleAnalyzeFile(args);
    case 'analyze_code':
      return handleAnalyzeCode(args);
    case 'analyze_many':
      return handleAnalyzeMany(args);
    case 'get_codebase_health':
      return handleCodebaseHealth(args);
    case 'get_quality_rules':
      return handleQualityRules();
    case 'get_file_context':
      return handleFileContext(args);
    case 'get_dependency_graph':
      return handleDependencyGraph(args);
    case 'get_impact_analysis':
      return handleImpactAnalysis(args);
    case 'suggest_refactoring':
      return handleSuggestRefactoring(args);
    case 'predict_impact_with_remediation':
      return handlePredictImpactWithRemediation(args);
    case 'get_violation_patterns':
      return handleViolationPatterns(args);
    // Graph-aware token-efficient tools
    case 'get_impact_set':
      return handleGetImpactSet(args);
    case 'get_centrality_rank':
      return handleGetCentralityRank(args);
    case 'trace_path':
      return handleTracePath(args);
    case 'summarize_file':
      return handleSummarizeFile(args);
    case 'find_callers':
      return handleFindCallers(args);
    case 'check_pre_edit_safety':
      return handleCheckPreEditSafety(args);
    case 'get_session_metrics':
      return handleGetSessionMetrics();
    // Knowledge graph intelligence tools
    case 'get_graph_report':
      return handleGetGraphReport(args);
    case 'query_graph':
      return handleQueryGraph(args);
    case 'explain_node':
      return handleExplainNode(args);
    case 'export_graph':
      return handleExportGraph(args);
    case 'merge_graphs':
      return handleMergeGraphs(args);
    case 'get_graph_viz':
      return handleGetGraphViz(args);
    // Platform integration tools
    case 'install_platform':
      return handleInstallPlatform(args);
    case 'install_git_hooks':
      return handleInstallGitHooks(args);
    case 'pr_review':
      return handlePRReview(args);
    default:
      return text(`Unknown tool: ${name}`);
  }
}
