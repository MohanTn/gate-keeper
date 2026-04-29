"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DependencyGraph = void 0;
class DependencyGraph {
    analyses = new Map();
    upsert(analysis) {
        this.analyses.set(analysis.path, analysis);
    }
    toGraphData() {
        const nodes = [];
        const edges = [];
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
    detectCycles() {
        const cycles = [];
        const visited = new Set();
        const stack = new Set();
        const dfs = (node, path) => {
            visited.add(node);
            stack.add(node);
            const analysis = this.analyses.get(node);
            if (analysis) {
                for (const dep of analysis.dependencies) {
                    const target = dep.target;
                    if (!this.analyses.has(target))
                        continue;
                    if (!visited.has(target)) {
                        dfs(target, [...path, target]);
                    }
                    else if (stack.has(target)) {
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
    findHotspots(topN = 5) {
        return Array.from(this.analyses.values())
            .sort((a, b) => a.rating - b.rating || b.violations.length - a.violations.length)
            .slice(0, topN);
    }
    overallRating() {
        const values = Array.from(this.analyses.values());
        if (values.length === 0)
            return 10;
        const sum = values.reduce((acc, a) => acc + a.rating, 0);
        return Math.round((sum / values.length) * 10) / 10;
    }
    basename(p) {
        return p.split('/').pop() ?? p;
    }
}
exports.DependencyGraph = DependencyGraph;
//# sourceMappingURL=dependency-graph.js.map