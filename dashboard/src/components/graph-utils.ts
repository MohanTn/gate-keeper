import { GraphData, GraphNode, GraphEdge } from '../types';
import { ThemeTokens, darkTokens } from '../ThemeContext';
import { isTestFile } from './arch-rendering';

// Default T for backward compat — components should pass theme explicitly
export const T = darkTokens;

export function healthColor(r: number, theme: ThemeTokens = T): string {
    if (r >= 8) return theme.green;
    if (r >= 6) return theme.yellow;
    if (r >= 4) return theme.orange;
    return theme.red;
}

export function healthLabel(r: number): string {
    if (r >= 8) return 'Healthy';
    if (r >= 6) return 'Warning';
    if (r >= 4) return 'Degraded';
    return 'Critical';
}

export function buildTooltip(node: GraphNode): string {
    const h = healthLabel(node.rating);
    return `${node.label}\n${'─'.repeat(20)}\n${h}  ·  ${node.rating}/10\nLines: ${node.metrics?.linesOfCode ?? 0}\nComplexity: ${node.metrics?.cyclomaticComplexity ?? 0}\nViolations: ${(node.violations ?? []).length}`;
}

export function makeNodeColor(color: string, theme: ThemeTokens = T) {
    return {
        background: theme.cardBg,
        border: color,
        highlight: { background: theme.cardBgHover, border: theme.accent },
        hover: { background: theme.cardBgHover, border: color },
    };
}

export function edgeId(from: string, to: string) { return `${from}→${to}`; }

export function buildVisNodes(
    nodes: GraphNode[],
    pinned: Map<string, { x: number; y: number }>,
    treePositions: Map<string, { x: number; y: number }>,
    theme: ThemeTokens = T,
    archMode: boolean = false,
): any[] {
    // For large graphs without layout positions, use a grid scatter
    const needsScatter = treePositions.size === 0 && nodes.length > 200;
    const cols = needsScatter ? Math.ceil(Math.sqrt(nodes.length)) : 0;

    return nodes.map((node, i) => {
        const color = healthColor(node.rating, theme);
        const scatterPos = needsScatter
            ? { x: (i % cols) * 220, y: Math.floor(i / cols) * 100 }
            : { x: 0, y: 0 };
        const pos = pinned.get(node.id) ?? treePositions.get(node.id) ?? scatterPos;
        const isTest = archMode && isTestFile(node.id);
        const label = isTest ? `[test] ${node.label}` : node.label;
        return {
            id: node.id,
            label,
            x: pos.x, y: pos.y,
            title: buildTooltip(node),
            shape: 'box',
            color: makeNodeColor(color, theme),
            opacity: isTest ? 0.7 : 1,
            font: { color: theme.text, size: 15, face: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' },
            borderWidth: 2,
            borderWidthSelected: 3,
            margin: { top: 12, right: 16, bottom: 12, left: 16 },
            shapeProperties: { borderRadius: 8 },
            mass: 1,
            physics: false,
            fixed: false,
            widthConstraint: { minimum: 100, maximum: 180 },
        };
    });
}

export function buildVisEdges(graphData: GraphData, theme: ThemeTokens = T): any[] {
    return graphData.edges.map(edge => {
        const from = typeof edge.source === 'string' ? edge.source : edge.source?.id;
        const to = typeof edge.target === 'string' ? edge.target : edge.target?.id;
        const isCirc = edge.type === 'circular';
        return {
            id: edgeId(from as string, to as string),
            from, to,
            color: {
                color: isCirc ? theme.edgeCircular : theme.edgeDefault,
                highlight: isCirc ? 'rgba(249,115,22,1)' : theme.edgeHighlight,
                hover: isCirc ? 'rgba(249,115,22,0.7)' : 'rgba(59,130,246,0.6)',
            },
            width: isCirc ? 2.5 : 2,
            arrows: { to: { enabled: true, scaleFactor: 0.4, type: 'arrow' } },
            smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.4 },
            dashes: isCirc ? [6, 4] : false,
            _isCircular: isCirc,
        };
    });
}

export function computeHierarchicalPositions(
    nodes: GraphNode[],
    edges: GraphEdge[],
): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    if (nodes.length === 0) return positions;

    const nodeIds = new Set(nodes.map(n => n.id));

    const childrenOf = new Map<string, Set<string>>();
    const parentOf = new Map<string, Set<string>>();
    for (const id of nodeIds) {
        childrenOf.set(id, new Set());
        parentOf.set(id, new Set());
    }
    for (const e of edges) {
        const from = typeof e.source === 'string' ? e.source : e.source?.id;
        const to = typeof e.target === 'string' ? e.target : e.target?.id;
        if (from && to && nodeIds.has(from) && nodeIds.has(to)) {
            childrenOf.get(to)!.add(from);
            parentOf.get(from)!.add(to);
        }
    }

    const roots: string[] = [];
    for (const id of nodeIds) {
        if (parentOf.get(id)!.size === 0) roots.push(id);
    }

    if (roots.length === 0) {
        const inDeg = new Map<string, number>();
        for (const id of nodeIds) inDeg.set(id, childrenOf.get(id)!.size);
        const sorted = [...nodeIds].sort((a, b) => inDeg.get(b)! - inDeg.get(a)!);
        roots.push(sorted[0]);
    }

    // Cycle-safe layer assignment via iterative DFS topological sort.
    // The old BFS updated layer values upward on every traversal, causing an infinite
    // loop when bidirectional import cycles exist. Iterative DFS detects back-edges
    // (the 'visiting' state) and skips them, guaranteeing O(V+E) termination.
    const visitState = new Map<string, 'unvisited' | 'visiting' | 'done'>();
    const topoOrder: string[] = [];
    for (const id of nodeIds) visitState.set(id, 'unvisited');

    for (const startId of nodeIds) {
        if (visitState.get(startId) !== 'unvisited') continue;
        const stack: Array<{ id: string; iter: IterableIterator<string> }> = [
            { id: startId, iter: (childrenOf.get(startId) ?? new Set()).values() },
        ];
        visitState.set(startId, 'visiting');
        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const { value: child, done } = frame.iter.next();
            if (done) {
                visitState.set(frame.id, 'done');
                topoOrder.push(frame.id);
                stack.pop();
            } else if (visitState.get(child) === 'unvisited') {
                visitState.set(child, 'visiting');
                stack.push({ id: child, iter: (childrenOf.get(child) ?? new Set()).values() });
            }
            // 'visiting' = back-edge (cycle), 'done' = cross/forward-edge — both skipped
        }
    }
    topoOrder.reverse(); // sources first: roots before their dependents

    // Single-pass longest-path propagation in topological order — O(V+E), cycle-safe
    const layer = new Map<string, number>();
    for (const id of topoOrder) layer.set(id, 0);
    for (const id of topoOrder) {
        const d = layer.get(id)!;
        for (const child of childrenOf.get(id) ?? []) {
            if ((layer.get(child) ?? 0) < d + 1) layer.set(child, d + 1);
        }
    }

    const maxLayer = Math.max(...layer.values(), 0);
    const layerNodes: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const [id, l] of layer) layerNodes[l].push(id);

    for (const ln of layerNodes) {
        ln.sort((a, b) => {
            const na = nodes.find(n => n.id === a)!;
            const nb = nodes.find(n => n.id === b)!;
            return na.label.localeCompare(nb.label);
        });
    }

    const tempY = new Map<string, number>();

    function medianY(id: string, refLayer: Map<string, number>): number {
        const neighbors = [...(parentOf.get(id) ?? []), ...(childrenOf.get(id) ?? [])];
        const ys = neighbors
            .map(nb => refLayer.get(nb))
            .filter((y): y is number => y !== undefined);
        if (ys.length === 0) return 0;
        ys.sort((a, b) => a - b);
        return ys[Math.floor(ys.length / 2)];
    }

    for (let pass = 0; pass < 2; pass++) {
        for (let col = 0; col <= maxLayer; col++) {
            const ids = layerNodes[col];
            ids.forEach((id, i) => tempY.set(id, i));
            layerNodes[col] = [...ids].sort((a, b) => medianY(a, tempY) - medianY(b, tempY));
        }
    }

    const LAYER_SPACING = 320;
    const NODE_SPACING = 150;

    for (let col = 0; col <= maxLayer; col++) {
        const ids = layerNodes[col];
        if (ids.length === 0) continue;
        const totalH = (ids.length - 1) * NODE_SPACING;
        for (let row = 0; row < ids.length; row++) {
            positions.set(ids[row], { x: col * LAYER_SPACING, y: row * NODE_SPACING - totalH / 2 });
        }
    }

    return positions;
}
