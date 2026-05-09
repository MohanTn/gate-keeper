import { GraphNode, GraphEdge, ArchMapping } from '../types';
import type { ArchLayer } from './arch-layers';

// ── Layout Constants (Container-style Wrapping Grid) ──────────
export const NODE_HORIZONTAL_GAP = 220;
export const NODE_VERTICAL_GAP = 150;
export const NODE_HEIGHT = 60;
export const LAYER_PADDING = 60;
export const LAYER_GUTTER = 120;
export const MAX_INNER_COLS = 4;
export const ARCH_HEADER_HEIGHT = 36;
export const CONTAINER_RADIUS = 12;

// ── Style Constants ───────────────────────────────────────────
export const ARCH_VIOLATION_EDGE_STYLE = {
  color: '#ef4444',
  highlightColor: '#dc2626',
  width: 2.5,
  dashes: [4, 4],
} as const;

export const ARCH_ALLOWED_EDGE_STYLE = {
  color: 'rgba(140,140,140,0.35)',
  highlightColor: 'rgba(100,100,100,0.7)',
  width: 1,
  dashes: [3, 6],
} as const;

export const ARCH_VIOLATION_NODE_BORDER = '#ef4444';
export const ARCH_VIOLATION_NODE_BORDER_WIDTH = 3;

// ── Color Helpers ─────────────────────────────────────────────
// Re-emit `rgba(r,g,b,a)` at a specified alpha. Returns input unchanged if not parseable.
export function withAlpha(color: string, alpha: number): string {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return color;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
}

export function deriveAccent(color: string): { border: string; header: string; text: string } {
  return {
    border: withAlpha(color, 0.55),
    header: withAlpha(color, 0.18),
    text: withAlpha(color, 0.95),
  };
}

// ── Grid Layout ───────────────────────────────────────────────
export interface LayerGeometry {
  layer: ArchLayer;
  label: string;
  color: string;
  centerX: number;
  width: number;
  innerCols: number;
  rowCount: number;
}

export interface ArchLayout {
  positions: Map<string, { x: number; y: number }>;
  geometry: Map<ArchLayer, LayerGeometry>;
  globalMinY: number;
  globalMaxY: number;
}

// Small layers stay as a 1-wide stack; only wrap when files won't fit comfortably.
// Threshold of 4 keeps narrow layers (like Application or Domain) tidy, while
// wide layers (like Use Case with 40+ files) wrap into a grid.
function gridDimensions(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 0 };
  if (n <= 4) return { cols: 1, rows: n };
  const cols = Math.min(MAX_INNER_COLS, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

// Greedy barycentric: order nodes by mean column-index of neighbors in the previous layer.
function orderByBarycenter(
  layerNodes: GraphNode[],
  edges: GraphEdge[],
  prevColumns: Map<string, number>,
): GraphNode[] {
  if (layerNodes.length <= 1 || prevColumns.size === 0) return layerNodes;

  const edgeMap = new Map<string, string[]>();
  for (const edge of edges) {
    const from = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const to = typeof edge.target === 'string' ? edge.target : edge.target.id;
    if (!edgeMap.has(from)) edgeMap.set(from, []);
    edgeMap.get(from)!.push(to);
    if (!edgeMap.has(to)) edgeMap.set(to, []);
    edgeMap.get(to)!.push(from);
  }

  const barycenters = new Map<string, number>();
  for (const node of layerNodes) {
    const neighbors = edgeMap.get(node.id) || [];
    const cols = neighbors.map(n => prevColumns.get(n)).filter((c): c is number => c !== undefined);
    barycenters.set(node.id, cols.length > 0 ? cols.reduce((a, b) => a + b, 0) / cols.length : 0);
  }

  return [...layerNodes].sort((a, b) => (barycenters.get(a.id) || 0) - (barycenters.get(b.id) || 0));
}

// Compute per-layer container geometry + node positions in a wrapping grid.
export function computeArchLayout(
  nodes: GraphNode[],
  layerOrder: ArchLayer[],
  nodeLayerMap: Map<string, ArchLayer>,
  edges: GraphEdge[],
  layerInfoMap: Map<ArchLayer, { label: string; color: string }>,
): ArchLayout {
  const layerBuckets = new Map<ArchLayer, GraphNode[]>();
  for (const layer of layerOrder) layerBuckets.set(layer, []);
  if (!layerBuckets.has('external')) layerBuckets.set('external', []);

  for (const node of nodes) {
    const layer = nodeLayerMap.get(node.id) || 'external';
    const bucket = layerBuckets.get(layer) || layerBuckets.get('external')!;
    bucket.push(node);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const geometry = new Map<ArchLayer, LayerGeometry>();
  const nonEmptyLayers = layerOrder.filter(l => (layerBuckets.get(l) || []).length > 0);

  let cursorX = 0;
  let prevColumns = new Map<string, number>();
  const allNodeYs: number[] = [];

  for (const layer of nonEmptyLayers) {
    const bucket = orderByBarycenter(layerBuckets.get(layer) || [], edges, prevColumns);
    const { cols, rows } = gridDimensions(bucket.length);
    const layerWidth = cols * NODE_HORIZONTAL_GAP + 2 * LAYER_PADDING;
    const centerX = cursorX + layerWidth / 2;

    const gridStartX = centerX - ((cols - 1) / 2) * NODE_HORIZONTAL_GAP;
    const gridHeight = (rows - 1) * NODE_VERTICAL_GAP;
    const gridStartY = -gridHeight / 2 + ARCH_HEADER_HEIGHT / 2;

    const currentColumns = new Map<string, number>();
    for (let i = 0; i < bucket.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gridStartX + col * NODE_HORIZONTAL_GAP;
      const y = gridStartY + row * NODE_VERTICAL_GAP;
      positions.set(bucket[i].id, { x, y });
      allNodeYs.push(y);
      currentColumns.set(bucket[i].id, col);
    }

    const info = layerInfoMap.get(layer) || { label: layer, color: 'rgba(120,120,120,0.08)' };
    geometry.set(layer, {
      layer,
      label: info.label,
      color: info.color,
      centerX,
      width: layerWidth,
      innerCols: cols,
      rowCount: rows,
    });

    cursorX += layerWidth + LAYER_GUTTER;
    prevColumns = currentColumns;
  }

  const globalMinY = allNodeYs.length > 0 ? Math.min(...allNodeYs) - NODE_HEIGHT / 2 - LAYER_PADDING : -300;
  const globalMaxY = allNodeYs.length > 0 ? Math.max(...allNodeYs) + NODE_HEIGHT / 2 + LAYER_PADDING : 300;
  return { positions, geometry, globalMinY, globalMaxY };
}

// Build a layerId → {label, color} lookup from arch mapping (or fallback list).
export function buildLayerInfoMap(
  archMapping: ArchMapping | undefined,
  fallbackLayers: Array<{ id: ArchLayer; label: string; color: string }>,
): Map<ArchLayer, { label: string; color: string }> {
  const map = new Map<ArchLayer, { label: string; color: string }>();
  const source = archMapping?.layers ?? fallbackLayers;
  for (const layer of source) {
    map.set(layer.id, { label: layer.label, color: layer.color });
  }
  return map;
}

// ── Container Drawing (canvas) ────────────────────────────────
function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function pathTopRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export function drawLayerContainer(
  ctx: CanvasRenderingContext2D,
  geom: LayerGeometry,
  globalMinY: number,
  globalMaxY: number,
): void {
  const x = geom.centerX - geom.width / 2;
  const y = globalMinY;
  const w = geom.width;
  const h = globalMaxY - globalMinY;
  const accent = deriveAccent(geom.color);

  pathRoundRect(ctx, x, y, w, h, CONTAINER_RADIUS);
  ctx.fillStyle = geom.color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accent.border;
  ctx.stroke();

  pathTopRoundRect(ctx, x, y, w, ARCH_HEADER_HEIGHT, CONTAINER_RADIUS);
  ctx.fillStyle = accent.header;
  ctx.fill();

  ctx.fillStyle = accent.text;
  ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(geom.label, geom.centerX, y + ARCH_HEADER_HEIGHT / 2);
}

// ── Test File Detection ───────────────────────────────────────
export function isTestFile(id: string): boolean {
  return /\.(test|spec)\.(t|j)sx?$/.test(id);
}
