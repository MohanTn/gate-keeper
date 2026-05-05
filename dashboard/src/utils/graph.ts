import { useTheme, ratingColor as themeRatingColor } from '../ThemeContext';
import { GraphData, GraphEdge, GraphNode, ExcludePattern } from '../types';

export const edgeKey = (e: GraphEdge): string => {
    const s = typeof e.source === 'string' ? e.source : e.source?.id;
    const t = typeof e.target === 'string' ? e.target : e.target?.id;
    return `${s}→${t}`;
};

export function mergeGraphData(prev: GraphData, delta: { nodes: GraphNode[]; edges: GraphEdge[] }): GraphData {
    const nodeMap = new Map(prev.nodes.map(n => [n.id, n]));
    for (const n of delta.nodes) nodeMap.set(n.id, n);
    const edgeMap = new Map(prev.edges.map(e => [edgeKey(e), e]));
    for (const e of delta.edges) edgeMap.set(edgeKey(e), e);
    return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
}

export function ratingColor(r: number, T: ReturnType<typeof useTheme>['T']): string {
    return themeRatingColor(r, T);
}

/** Convert a simple glob pattern to a RegExp. Supports * and ** wildcards. */
export function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__GLOBSTAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__GLOBSTAR__/g, '.*');
    return new RegExp(escaped, 'i');
}

export function matchesAnyPattern(filePath: string, patterns: ExcludePattern[]): boolean {
    const fileName = filePath.split('/').pop() ?? filePath;
    return patterns.some(p => {
        const re = globToRegex(p.pattern);
        return re.test(filePath) || re.test(fileName);
    });
}
