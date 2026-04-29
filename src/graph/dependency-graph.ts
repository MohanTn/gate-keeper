import { FileAnalysis, GraphData, GraphEdge, GraphNode } from '../types';

export interface CycleInfo {
  nodes: string[];
}

export class DependencyGraph {
  private analyses = new Map<string, FileAnalysis>();

  upsert(analysis: FileAnalysis): void {
    this.analyses.set(analysis.path, analysis);
  }

  toGraphData(): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

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
        if (this.analyses.has(dep.target)) {
          edges.push({
            source: dep.source,
            target: dep.target,
            type: dep.type,
            strength: dep.weight
          });
        }
      }
    }

    return { nodes, edges };
  }

  detectCycles(): CycleInfo[] {
    const cycles: CycleInfo[] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      stack.add(node);

      const analysis = this.analyses.get(node);
      if (analysis) {
        for (const dep of analysis.dependencies) {
          const target = dep.target;
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
