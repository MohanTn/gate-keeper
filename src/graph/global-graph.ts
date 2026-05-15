/**
 * Global graph — persistent cross-repo index stored at ~/.gate-keeper/global-graph.json.
 *
 * Merges per-repo graph JSONs into a single index. Detects shared library
 * dependencies across repos and provides a cross-repo query interface.
 *
 * Storage format:
 *   {
 *     version: "1.0",
 *     repos: [{ path, label, lastIndexedAt }],
 *     nodes: [...merged nodes],
 *     edges: [...merged edges],
 *     crossRepoImports: [{ source, target, fromRepo, toRepo }],
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';
import { mergeGraphs } from './graph-export';

const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
const GLOBAL_GRAPH_FILE = path.join(GK_DIR, 'global-graph.json');

export interface GlobalGraphRepo {
  path: string;
  label: string;
  lastIndexedAt: number;
  nodeCount: number;
}

export interface GlobalGraphData {
  version: string;
  generatedAt: number;
  repos: GlobalGraphRepo[];
  nodes: Array<{ id: string; label: string; rating: number }>;
  edges: Array<{ source: string; target: string; type?: string }>;
  crossRepoImports: Array<{ source: string; target: string; fromRepo: string; toRepo: string }>;
}

// ── Load / Save ────────────────────────────────────────────

export function loadGlobalGraph(): GlobalGraphData {
  try {
    if (fs.existsSync(GLOBAL_GRAPH_FILE)) {
      return JSON.parse(fs.readFileSync(GLOBAL_GRAPH_FILE, 'utf8')) as GlobalGraphData;
    }
  } catch {
    // Corrupt or missing — return fresh
  }
  return emptyGlobalGraph();
}

export function saveGlobalGraph(data: GlobalGraphData): void {
  fs.mkdirSync(GK_DIR, { recursive: true });
  data.generatedAt = Date.now();
  fs.writeFileSync(GLOBAL_GRAPH_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function emptyGlobalGraph(): GlobalGraphData {
  return {
    version: '1.0',
    generatedAt: Date.now(),
    repos: [],
    nodes: [],
    edges: [],
    crossRepoImports: [],
  };
}

// ── Index a repo's graph into the global index ────────────

export function indexRepo(
  repoPath: string,
  repoLabel: string,
  localNodes: ReadonlyArray<{ id: string; label: string; rating: number }>,
  localEdges: ReadonlyArray<{ source: string; target: string; type?: string }>,
): { added: number; conflicts: number } {
  const global = loadGlobalGraph();

  // Update or add the repo entry
  const existingRepo = global.repos.find(r => r.path === repoPath);
  if (existingRepo) {
    existingRepo.lastIndexedAt = Date.now();
    existingRepo.nodeCount = localNodes.length;
  } else {
    global.repos.push({
      path: repoPath, label: repoLabel,
      lastIndexedAt: Date.now(), nodeCount: localNodes.length,
    });
  }

  // Merge nodes (prefix IDs to avoid collision — e.g. "repo-id:actual-id")
  const prefix = repoLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  const prefixedNodes = localNodes.map(n => ({
    ...n,
    id: `${prefix}:${n.id}`,
  }));
  const prefixedEdges = localEdges.map(e => ({
    source: `${prefix}:${e.source}`,
    target: `${prefix}:${e.target}`,
    type: e.type,
  }));

  // Union-merge with existing global; GNode/GEdge have optional fields so
  // the narrower global types are structurally compatible with the expected shape.
  const merged = mergeGraphs(
    { nodes: global.nodes, edges: global.edges },
    { nodes: prefixedNodes, edges: prefixedEdges },
  );

  global.nodes = merged.nodes;
  global.edges = merged.edges;
  global.generatedAt = Date.now();

  saveGlobalGraph(global);

  return { added: localNodes.length, conflicts: merged.conflicts.length };
}

// ── Query ──────────────────────────────────────────────────

export function queryGlobalGraph(
  query: string,
): { repos: GlobalGraphRepo[]; nodeCount: number; edgeCount: number; answer: string } {
  const global = loadGlobalGraph();

  const q = query.toLowerCase();
  const results: string[] = [];

  if (q.includes('repo') || q.includes('how many')) {
    results.push(`Indexed ${global.repos.length} repos with ${global.nodes.length} total nodes and ${global.edges.length} edges.`);
  }

  if (q.includes('shared') || q.includes('cross')) {
    results.push(
      global.crossRepoImports.length > 0
        ? `${global.crossRepoImports.length} cross-repo import(s) detected.`
        : 'No cross-repo imports tracked yet.',
    );
  }

  if (q.includes('worst') || q.includes('low')) {
    const sorted = [...global.nodes].sort((a, b) => a.rating - b.rating).slice(0, 5);
    if (sorted.length > 0) {
      results.push('Worst-rated nodes:', sorted.map(n => `  ${n.label} — ${n.rating}/10`).join('\n'));
    }
  }

  return {
    repos: global.repos,
    nodeCount: global.nodes.length,
    edgeCount: global.edges.length,
    answer: results.length > 0 ? results.join('\n') : `No answer for "${query}". Try: repos, cross-repo, worst-rated.`,
  };
}

/** Path to the global graph on disk */
export function getGlobalGraphPath(): string {
  return GLOBAL_GRAPH_FILE;
}
