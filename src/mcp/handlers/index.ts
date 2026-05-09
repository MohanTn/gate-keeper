/**
 * MCP Tool Handlers — barrel module
 *
 * Re-exports all handler functions from domain sub-modules and provides
 * the tool-call router used by the JSON-RPC message handler.
 */

import { text } from './shared';
import {
  handleAnalyzeFile,
  handleAnalyzeCode,
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

export { text };
export {
  handleAnalyzeFile,
  handleAnalyzeCode,
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

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'analyze_file':
      return handleAnalyzeFile(args);
    case 'analyze_code':
      return handleAnalyzeCode(args);
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
    default:
      return text(`Unknown tool: ${name}`);
  }
}
