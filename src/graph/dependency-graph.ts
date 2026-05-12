import { FileAnalysis, GraphData, GraphEdge, GraphNode } from '../types';

export interface CycleInfo {
  nodes: string[];
}

/**
 * Topological fix order. An import edge source→target means "source depends on
 * target", so target must be fixed before source. We run Kahn's algorithm on
 * the reversed adjacency: a node is dequeued only when every file it depends on
 * has already been emitted.
 *
 * On cycle stall we break by lowest rating (worst file first) so the worst code
 * gets attention before its co-dependent neighbours.
 */
export function topoSort(
  nodeIds: string[],
  edges: ReadonlyArray<{ source: string; target: string }>,
  ratingByNode: ReadonlyMap<string, number> = new Map(),
): string[] {
  const remainingDeps = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const nodeSet = new Set(nodeIds);

  for (const id of nodeIds) {
    remainingDeps.set(id, new Set());
    dependents.set(id, new Set());
  }
  for (const e of edges) {
    if (!nodeSet.has(e.source) || !nodeSet.has(e.target) || e.source === e.target) continue;
    remainingDeps.get(e.source)!.add(e.target);
    dependents.get(e.target)!.add(e.source);
  }

  const ordered: string[] = [];
  const ready: string[] = [];
  for (const id of nodeIds) {
    if (remainingDeps.get(id)!.size === 0) ready.push(id);
  }

  while (ordered.length < nodeIds.length) {
    if (ready.length === 0) {
      // Cycle stall: pick the lowest-rated remaining node and free it.
      let pick: string | undefined;
      let pickRating = Infinity;
      for (const [id, deps] of remainingDeps) {
        if (deps.size === 0) continue;
        const r = ratingByNode.get(id) ?? 10;
        if (r < pickRating) {
          pickRating = r;
          pick = id;
        }
      }
      if (pick === undefined) break;
      remainingDeps.get(pick)!.clear();
      ready.push(pick);
    }
    const next = ready.shift()!;
    if (remainingDeps.get(next) === undefined) continue;
    ordered.push(next);
    remainingDeps.delete(next);
    for (const dep of dependents.get(next) ?? []) {
      const set = remainingDeps.get(dep);
      if (!set) continue;
      set.delete(next);
      if (set.size === 0) ready.push(dep);
    }
  }

  return ordered;
}

export class DependencyGraph {
  private analyses = new Map<string, FileAnalysis>();

  remove(filePath: string): boolean {
    return this.analyses.delete(filePath);
  }

  upsert(analysis: FileAnalysis): void {
    this.analyses.set(analysis.path, analysis);
  }

  toGraphData(): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();

    // Build a type→filePath map from C# definedTypes for cross-file resolution
    const typeToFile = new Map<string, string>();
    for (const analysis of this.analyses.values()) {
      if (analysis.definedTypes) {
        for (const typeName of analysis.definedTypes) {
          // If multiple files define the same type name, first one wins
          if (!typeToFile.has(typeName)) {
            typeToFile.set(typeName, analysis.path);
          }
        }
      }
    }

    for (const analysis of this.analyses.values()) {
      nodes.push({
        id: analysis.path,
        label: this.basename(analysis.path),
        type: analysis.language,
        rating: analysis.rating,
        size: Math.max(1, analysis.metrics.linesOfCode / 100),
        violations: analysis.violations,
        metrics: analysis.metrics
      });

      for (const dep of analysis.dependencies) {
        let targetPath = dep.target;

        // Resolve __type__:TypeName references to file paths
        if (targetPath.startsWith('__type__:')) {
          const typeName = targetPath.substring('__type__:'.length);
          const resolved = typeToFile.get(typeName);
          if (resolved && resolved !== analysis.path) {
            targetPath = resolved;
          } else {
            continue; // Unresolved type or self-reference — skip
          }
        }

        if (this.analyses.has(targetPath)) {
          // Deduplicate: don't add the same source→target edge twice
          const edgeId = `${dep.source}→${targetPath}`;
          if (!edgeSet.has(edgeId)) {
            edgeSet.add(edgeId);
            edges.push({
              source: dep.source,
              target: targetPath,
              type: dep.type,
              strength: dep.weight
            });
          }
        }
      }
    }

    return { nodes, edges };
  }

  detectCycles(): CycleInfo[] {
    const cycles: CycleInfo[] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    // Build a type→filePath map for resolving __type__ refs
    const typeToFile = new Map<string, string>();
    for (const analysis of this.analyses.values()) {
      if (analysis.definedTypes) {
        for (const typeName of analysis.definedTypes) {
          if (!typeToFile.has(typeName)) typeToFile.set(typeName, analysis.path);
        }
      }
    }

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      stack.add(node);

      const analysis = this.analyses.get(node);
      if (analysis) {
        for (const dep of analysis.dependencies) {
          let target = dep.target;
          if (target.startsWith('__type__:')) {
            const resolved = typeToFile.get(target.substring('__type__:'.length));
            if (resolved && resolved !== node) target = resolved;
            else continue;
          }
          if (!this.analyses.has(target)) continue;
          if (!visited.has(target)) {
            dfs(target, [...path, target]);
          } else if (stack.has(target)) {
            const cycleStart = path.indexOf(target);
            cycles.push({ nodes: path.slice(cycleStart) });
          }
        }
      }

      stack.delete(node);
    };

    for (const key of this.analyses.keys()) {
      if (!visited.has(key)) {
        dfs(key, [key]);
      }
    }

    return cycles;
  }

  findHotspots(topN = 5): FileAnalysis[] {
    return Array.from(this.analyses.values())
      .sort((a, b) => a.rating - b.rating || b.violations.length - a.violations.length)
      .slice(0, topN);
  }

  overallRating(): number {
    const values = Array.from(this.analyses.values());
    if (values.length === 0) return 10;
    const sum = values.reduce((acc, a) => acc + a.rating, 0);
    return Math.round((sum / values.length) * 10) / 10;
  }

  private basename(p: string): string {
    return p.split('/').pop() ?? p;
  }
}
