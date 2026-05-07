import { GraphNode, GraphEdge } from '../types';
import { edgeId } from './graph-utils';

// ── Layer Types ────────────────────────────────────────────────
export type ArchLayer = 'api' | 'service' | 'domain' | 'infrastructure' | 'external';

export interface LayerConfig {
  id: ArchLayer;
  label: string;
  folderPatterns: string[];
  filePatterns: RegExp[];
  color: string;
  order: number;
}

export interface LayerBand {
  layer: ArchLayer;
  label: string;
  color: string;
  x: number;
  width: number;
  minY: number;
  maxY: number;
  height: number;
}

// ── Layer Configuration ────────────────────────────────────────
export const LAYER_CONFIG: LayerConfig[] = [
  {
    id: 'api',
    label: 'API Layer',
    folderPatterns: ['mcp', 'api', 'controllers', 'routes', 'hook-receiver'],
    filePatterns: [/\.controller\.ts/, /\.route\.ts/, /\.handler\.ts/, /\.endpoint\.ts/],
    color: 'rgba(219, 39, 119, 0.08)',
    order: 0,
  },
  {
    id: 'service',
    label: 'Service Layer',
    folderPatterns: ['service', 'services', 'usecases', 'daemon', 'viz'],
    filePatterns: [/\.service\.ts/, /\.usecase\.ts/, /\.use-case\.ts/, /\.application\.ts/],
    color: 'rgba(124, 58, 255, 0.08)',
    order: 1,
  },
  {
    id: 'domain',
    label: 'Domain Layer',
    folderPatterns: ['domain', 'entities', 'models', 'analyzer', 'rating', 'types'],
    filePatterns: [/\.model\.ts/, /\.entity\.ts/, /\.domain\.ts/, /\.types\.ts/, /types\.ts$/],
    color: 'rgba(34, 197, 94, 0.08)',
    order: 2,
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure Layer',
    folderPatterns: ['infrastructure', 'cache', 'graph', 'repository', 'persistence', 'database'],
    filePatterns: [/\.repository\.ts/, /\.repo\.ts/, /\.cache\.ts/, /\.db\.ts/, /\.storage\.ts/],
    color: 'rgba(249, 115, 22, 0.08)',
    order: 3,
  },
];

const LAYER_ORDER: ArchLayer[] = ['api', 'service', 'domain', 'infrastructure', 'external'];

// ── Layout Constants ──────────────────────────────────────────
const COLUMN_WIDTH = 320;
const COLUMN_PADDING = 20;
const NODE_Y_SPACING = 130;
const ROW_PADDING = 30;

// ── Classification Logic ───────────────────────────────────────
export function classifyNodeToLayer(nodeId: string): ArchLayer {
  const lower = nodeId.toLowerCase();
  const parts = lower.split('/');
  const filename = parts[parts.length - 1];

  // Check folder patterns
  for (const config of LAYER_CONFIG) {
    for (const pattern of config.folderPatterns) {
      if (parts.some(part => part === pattern)) {
        return config.id;
      }
    }
  }

  // Check filename patterns
  for (const config of LAYER_CONFIG) {
    for (const pattern of config.filePatterns) {
      if (pattern.test(filename)) {
        return config.id;
      }
    }
  }

  return 'external';
}

// ── Position Computation ───────────────────────────────────────
export function computeArchLayerPositions(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const layerMap = new Map<ArchLayer, GraphNode[]>();

  // Group nodes by layer
  for (const layer of LAYER_ORDER) {
    layerMap.set(layer, []);
  }

  for (const node of nodes) {
    const layer = classifyNodeToLayer(node.id);
    const bucket = layerMap.get(layer) || layerMap.get('external')!;
    bucket.push(node);
  }

  // Compute positions: vertical swimlanes
  const positions = new Map<string, { x: number; y: number }>();

  for (const layer of LAYER_ORDER) {
    const layerNodes = layerMap.get(layer) || [];
    const layerIndex = LAYER_ORDER.indexOf(layer);
    const x = layerIndex * COLUMN_WIDTH;

    // Distribute nodes vertically within this layer column
    const totalHeight = (layerNodes.length - 1) * NODE_Y_SPACING;
    const startY = -totalHeight / 2; // Center vertically

    for (let i = 0; i < layerNodes.length; i++) {
      const y = startY + i * NODE_Y_SPACING;
      positions.set(layerNodes[i].id, { x, y });
    }
  }

  return positions;
}

// ── Violation Detection ────────────────────────────────────────
export function detectArchViolations(edges: GraphEdge[], nodeLayerMap: Map<string, ArchLayer>): Set<string> {
  const violations = new Set<string>();

  for (const edge of edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

    const sourceLayer = nodeLayerMap.get(sourceId) || 'external';
    const targetLayer = nodeLayerMap.get(targetId) || 'external';

    const sourceIdx = LAYER_ORDER.indexOf(sourceLayer);
    const targetIdx = LAYER_ORDER.indexOf(targetLayer);

    // Violation 1: Wrong-direction import (inner layer importing from outer)
    // Dependencies should flow inward (0 → 1 → 2 → 3 → 4)
    // A violation occurs when source > target in layer order
    if (sourceIdx > targetIdx) {
      violations.add(edgeId(sourceId, targetId));
    }

    // Violation 2: Core layers (domain/service) depending on external
    if ((sourceLayer === 'domain' || sourceLayer === 'service') && targetLayer === 'external') {
      violations.add(edgeId(sourceId, targetId));
    }

    // Violation 3: Circular dependencies across layers
    if (edge.type === 'circular' && sourceLayer !== targetLayer) {
      violations.add(edgeId(sourceId, targetId));
    }
  }

  return violations;
}

// ── Layer Band Geometry ────────────────────────────────────────
export function getLayerBands(
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
  nodeLayerMap: Map<string, ArchLayer>,
): LayerBand[] {
  const bands: LayerBand[] = [];

  for (const layer of LAYER_ORDER) {
    const layerNodes = nodes.filter(n => (nodeLayerMap.get(n.id) || 'external') === layer);
    if (layerNodes.length === 0) continue;

    const layerIndex = LAYER_ORDER.indexOf(layer);
    const config = LAYER_CONFIG.find(c => c.id === layer);
    if (!config) continue;

    // Get Y bounds from node positions
    const ys = layerNodes
      .map(n => positions.get(n.id)?.y || 0)
      .filter(y => y !== undefined);

    const minY = Math.min(...ys) - NODE_Y_SPACING / 2;
    const maxY = Math.max(...ys) + NODE_Y_SPACING / 2;
    const height = maxY - minY;

    const x = layerIndex * COLUMN_WIDTH;

    bands.push({
      layer,
      label: config.label,
      color: config.color,
      x,
      width: COLUMN_WIDTH,
      minY,
      maxY,
      height,
    });
  }

  return bands;
}

// ── Build Layer Map ───────────────────────────────────────────
export function buildNodeLayerMap(nodes: GraphNode[]): Map<string, ArchLayer> {
  const map = new Map<string, ArchLayer>();
  for (const node of nodes) {
    map.set(node.id, classifyNodeToLayer(node.id));
  }
  return map;
}

// ── Styling Constants ──────────────────────────────────────────
export const ARCH_VIOLATION_EDGE_STYLE = {
  color: '#ef4444',
  highlightColor: '#dc2626',
  width: 2.5,
  dashes: [4, 4],
} as const;

export const ARCH_CANVAS_PADDING = { x: COLUMN_PADDING, y: ROW_PADDING };
