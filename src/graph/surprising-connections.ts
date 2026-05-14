/**
 * Surprising connection detection for the knowledge graph.
 *
 * "Surprising" = a dependency edge that crosses module boundaries in an
 * unexpected way. Scored by: how far apart the directories are × how rare
 * that specific cross-module path is.
 *
 * score = directoryDistance(a, b) / log(crossEdgeCount + 1)
 *
 * High score = few edges between those modules + deep directory separation.
 */

import * as path from 'path';

interface GNode { id: string }
interface GEdge { source: string; target: string }

export interface SurprisingConnection {
  source: string;
  target: string;
  sourceModule: string;
  targetModule: string;
  score: number;
  explanation: string;
}

// Common single-level prefixes that aren't meaningful module names on their own.
const COMMON_PREFIXES = new Set(['src', 'lib', 'app', 'packages', 'modules', 'source']);

/**
 * Returns the "module" label for a file path — the meaningful top-level
 * directory group. Skips common language-convention prefixes (src/, lib/)
 * so that `src/auth/service.ts` → `auth`, not `src`.
 */
export function getModule(filePath: string, repoRoot: string): string {
  const rel = path.relative(repoRoot, filePath);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length <= 1) return '(root)';
  if (COMMON_PREFIXES.has(parts[0]!) && parts.length > 2) return parts[1]!;
  return parts[0]!;
}

function directoryDistance(a: string, b: string): number {
  const aParts = a.split(path.sep);
  const bParts = b.split(path.sep);
  let common = 0;
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    if (aParts[i] === bParts[i]) common++;
    else break;
  }
  return (aParts.length - 1 - common) + (bParts.length - 1 - common);
}

/**
 * Find edges that cross module boundaries, ranked by "unexpectedness".
 * Returns at most `topN` results.
 */
export function findSurprisingConnections(
  nodes: ReadonlyArray<GNode>,
  edges: ReadonlyArray<GEdge>,
  repoRoot: string,
  topN = 10,
): SurprisingConnection[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const moduleOf = new Map<string, string>();
  for (const n of nodes) moduleOf.set(n.id, getModule(n.id, repoRoot));

  // Count cross-module edges per module-pair key
  const pairCounts = new Map<string, number>();
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const sm = moduleOf.get(e.source) ?? '(unknown)';
    const tm = moduleOf.get(e.target) ?? '(unknown)';
    if (sm !== tm) {
      const key = `${sm}→${tm}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }

  const results: SurprisingConnection[] = [];
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const sm = moduleOf.get(e.source) ?? '(unknown)';
    const tm = moduleOf.get(e.target) ?? '(unknown)';
    if (sm === tm) continue;

    const pairCount = pairCounts.get(`${sm}→${tm}`) ?? 1;
    const dist = directoryDistance(e.source, e.target);
    const score = dist / Math.log(pairCount + 1);

    results.push({
      source: e.source,
      target: e.target,
      sourceModule: sm,
      targetModule: tm,
      score,
      explanation: `${sm} → ${tm} (${pairCount} cross-edge${pairCount !== 1 ? 's' : ''}, distance ${dist})`,
    });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .filter((r, i, arr) => {
      // Deduplicate: keep only first occurrence of each source→target pair
      return arr.findIndex(x => x.source === r.source && x.target === r.target) === i;
    })
    .slice(0, topN);
}
