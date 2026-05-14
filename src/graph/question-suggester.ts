/**
 * Auto-generates suggested questions about the codebase knowledge graph.
 *
 * Graphify-style: identifies god nodes (highest centrality) and worst-rated
 * files, then generates 4-5 questions an agent is well-positioned to answer
 * using the existing graph tools.
 */

import * as path from 'path';
import { computeCentrality } from './graph-algorithms';
import { getModule } from './surprising-connections';

interface GNode { id: string; label: string; rating: number }
interface GEdge { source: string; target: string }

export type QuestionType = 'impact' | 'dependency' | 'path' | 'health' | 'explanation' | 'callers';

export interface SuggestedQuestion {
  question: string;
  type: QuestionType;
  tool: string;
  params: Record<string, string | number>;
}

/**
 * Generate up to `maxQuestions` suggested questions from the graph topology.
 * Questions are ordered by estimated usefulness.
 */
export function suggestQuestions(
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
  repoRoot: string,
  maxQuestions = 5,
): SuggestedQuestion[] {
  if (nodes.length === 0) return [];

  const questions: SuggestedQuestion[] = [];
  const centrality = computeCentrality(nodes as GNode[], edges as GEdge[]);
  const godNodes = centrality.slice(0, 3);
  const worstNode = [...nodes].sort((a, b) => a.rating - b.rating)[0];
  const modules = new Set(nodes.map(n => getModule(n.id, repoRoot)));

  // Impact questions for god nodes
  for (const god of godNodes.slice(0, 2)) {
    const label = path.relative(repoRoot, god.path);
    questions.push({
      question: `What would break if ${label} changed?`,
      type: 'impact',
      tool: 'get_impact_set',
      params: { file_path: god.path, depth: 3 },
    });
  }

  // Dependency question for the most-imported node
  const topByInDegree = centrality.sort((a, b) => b.inDegree - a.inDegree)[0];
  if (topByInDegree) {
    const label = path.relative(repoRoot, topByInDegree.path);
    questions.push({
      question: `What depends on ${label}?`,
      type: 'dependency',
      tool: 'get_impact_set',
      params: { file_path: topByInDegree.path, depth: 1 },
    });
  }

  // Path question: god node → worst rated file
  if (godNodes[0] && worstNode && worstNode.id !== godNodes[0]?.path) {
    const srcLabel = path.relative(repoRoot, godNodes[0].path);
    const tgtLabel = path.relative(repoRoot, worstNode.id);
    questions.push({
      question: `How does ${srcLabel} connect to ${tgtLabel} (lowest-rated file)?`,
      type: 'path',
      tool: 'trace_path',
      params: { source: godNodes[0].path, target: worstNode.id },
    });
  }

  // Health question for worst-rated file
  if (worstNode && worstNode.rating < 7) {
    const label = path.relative(repoRoot, worstNode.id);
    questions.push({
      question: `How unhealthy is ${label} and what should be fixed first?`,
      type: 'health',
      tool: 'suggest_refactoring',
      params: { file_path: worstNode.id },
    });
  }

  // Module-level question if multiple modules exist
  if (modules.size > 2 && godNodes[0]) {
    const label = path.relative(repoRoot, godNodes[0].path);
    questions.push({
      question: `Which modules does ${label} bridge, and is that coupling intentional?`,
      type: 'explanation',
      tool: 'explain_node',
      params: { file_path: godNodes[0].path },
    });
  }

  return questions.slice(0, maxQuestions);
}
