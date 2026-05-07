import { GraphNode, GraphEdge, ArchMapping } from '../types';
import { edgeId } from './graph-utils';

// ── Layer Types ────────────────────────────────────────────────
export type ArchLayer = string; // Flexible string type to support custom layers
export type ViolationSeverity = 'error' | 'warning' | 'info';
export type ViolationType = 'reverse-dependency' | 'external-from-core' | 'cross-layer-cycle';

export interface ArchViolation {
  edgeId: string;
  sourceId: string;
  targetId: string;
  sourceLayer: ArchLayer;
  targetLayer: ArchLayer;
  type: ViolationType;
  severity: ViolationSeverity;
  confidence: number; // 0-1, how confident we are this is a real violation
  reason: string;
  suggestion?: string;
}

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

// ── Safe Imports Configuration ─────────────────────────────────
// Libraries that are safe to import from anywhere (utility/foundational)
const SAFE_EXTERNAL_LIBS = new Set([
  'date-fns', 'lodash', 'zod', 'joi', 'yup',
  'axios', 'got', 'node-fetch',
  'uuid', 'nanoid',
  'chalk', 'colors', 'winston', 'pino',
  'dotenv',
  'ramda',
  'typescript', 'ts-node',
  '@types',
]);

// Allowed layer transitions (source → target is OK)
// If not in this list, it's a violation
const ALLOWED_TRANSITIONS: Set<string> = new Set([
  'api→service',      // Controllers → Services
  'api→domain',       // Controllers → Models/Types
  'service→domain',   // Services → Domain/Entities
  'service→infrastructure', // Services → Repositories
  'infrastructure→domain',  // Repos → Models
  'domain→domain',    // Within domain layer
  'service→service',  // Within service layer
  'infrastructure→infrastructure', // Within infrastructure
  'api→api',          // Within API layer
]);

// ── Layout Constants ──────────────────────────────────────────
const LAYER_COLUMN_WIDTH = 420; // Horizontal spacing between layers (increased for clarity)
const NODE_WIDTH = 120;
const NODE_HEIGHT = 60;
const HORIZONTAL_NODE_GAP = 100;  // Space between nodes in same row (increased to reduce overlaps)
const VERTICAL_NODE_GAP = 180;   // Space between rows (increased for better separation)
const LAYER_PADDING = 60; // Padding around layer swimlanes (increased)

// ── Classification Logic ───────────────────────────────────────
export function classifyNodeToLayer(
  nodeId: string,
  fileMap?: Record<string, string>,
  layerConfigs: LayerConfig[] = LAYER_CONFIG
): ArchLayer {
  // Check direct file map first (from arch.json)
  if (fileMap && fileMap[nodeId]) {
    return fileMap[nodeId];
  }

  const lower = nodeId.toLowerCase();
  const parts = lower.split('/');
  const filename = parts[parts.length - 1];

  // Check folder patterns (only if configs have folderPatterns)
  for (const config of layerConfigs) {
    if (config.folderPatterns) {
      for (const pattern of config.folderPatterns) {
        if (parts.some(part => part === pattern)) {
          return config.id;
        }
      }
    }
  }

  // Check filename patterns (only if configs have filePatterns)
  for (const config of layerConfigs) {
    if (config.filePatterns) {
      for (const pattern of config.filePatterns) {
        if (pattern.test(filename)) {
          return config.id;
        }
      }
    }
  }

  return 'external';
}

// ── Helper: Get layer order from archMapping or default ────────
function getLayerOrder(archMapping?: ArchMapping): ArchLayer[] {
  if (!archMapping) return LAYER_ORDER;
  return archMapping.layers.sort((a, b) => a.order - b.order).map(l => l.id);
}

// ── Helper: Order nodes within a layer to minimize edge crossings ────────
// Uses a greedy barycentric positioning heuristic
function orderNodesInLayer(
  layerNodes: GraphNode[],
  edges: GraphEdge[],
  adjacentLayerPositions: Map<string, number> // node id → position in adjacent layer
): GraphNode[] {
  if (layerNodes.length <= 1) return layerNodes;

  // Build edge map for quick lookup
  const edgeMap = new Map<string, string[]>();
  for (const edge of edges) {
    const from = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const to = typeof edge.target === 'string' ? edge.target : edge.target.id;
    if (!edgeMap.has(from)) edgeMap.set(from, []);
    edgeMap.get(from)!.push(to);
    if (!edgeMap.has(to)) edgeMap.set(to, []);
    edgeMap.get(to)!.push(from);
  }

  // If no adjacent positions available, use original order
  if (adjacentLayerPositions.size === 0) return layerNodes;

  // Calculate barycentric coordinates for each node
  const barycenters = new Map<string, number>();
  for (const node of layerNodes) {
    const neighbors = edgeMap.get(node.id) || [];
    const positions = neighbors
      .map(nid => adjacentLayerPositions.get(nid))
      .filter((p): p is number => p !== undefined);

    if (positions.length > 0) {
      const avg = positions.reduce((a, b) => a + b, 0) / positions.length;
      barycenters.set(node.id, avg);
    } else {
      barycenters.set(node.id, 0);
    }
  }

  // Sort nodes by barycentric coordinate
  return [...layerNodes].sort((a, b) => (barycenters.get(a.id) || 0) - (barycenters.get(b.id) || 0));
}

// ── Position Computation ───────────────────────────────────────
export function computeArchLayerPositions(
  nodes: GraphNode[],
  archMapping?: ArchMapping,
  edges?: GraphEdge[]
): Map<string, { x: number; y: number }> {
  const layerOrder = getLayerOrder(archMapping);
  const fileMap = archMapping ? { ...archMapping.files, ...archMapping.overrides } : undefined;
  const layerConfigs = archMapping ? (archMapping.layers as LayerConfig[]) : LAYER_CONFIG;
  const layerMap = new Map<ArchLayer, GraphNode[]>();

  // Group nodes by layer
  for (const layer of layerOrder) {
    layerMap.set(layer, []);
  }
  // Always ensure 'external' layer exists for fallback
  if (!layerMap.has('external')) {
    layerMap.set('external', []);
  }

  for (const node of nodes) {
    const layer = classifyNodeToLayer(node.id, fileMap, layerConfigs);
    const bucket = layerMap.get(layer) || layerMap.get('external')!;
    bucket.push(node);
  }

  // Compute positions: horizontal swimlane layout with improved spacing and intelligent node ordering
  const positions = new Map<string, { x: number; y: number }>();
  let previousLayerPositions = new Map<string, number>(); // Track positions from previous layer

  for (let layerIdx = 0; layerIdx < layerOrder.length; layerIdx++) {
    const layer = layerOrder[layerIdx];
    let layerNodes = layerMap.get(layer) || [];
    if (layerNodes.length === 0) continue;

    // Order nodes within layer to reduce edge crossings (if edges are available)
    if (edges && edges.length > 0 && previousLayerPositions.size > 0) {
      layerNodes = orderNodesInLayer(layerNodes, edges, previousLayerPositions);
    }

    const layerIndex = layerOrder.indexOf(layer);
    const layerX = layerIndex * LAYER_COLUMN_WIDTH;

    // Distribute nodes in a 2-column grid within each layer
    const cols = Math.min(2, Math.ceil(Math.sqrt(layerNodes.length)));
    const rows = Math.ceil(layerNodes.length / cols);

    // Calculate total dimensions
    const gridWidth = (cols - 1) * HORIZONTAL_NODE_GAP + NODE_WIDTH;
    const gridHeight = (rows - 1) * VERTICAL_NODE_GAP + NODE_HEIGHT;
    const startX = layerX - gridWidth / 2;
    const startY = -gridHeight / 2;

    // Track positions for next layer's ordering
    const currentLayerPositions = new Map<string, number>();

    for (let i = 0; i < layerNodes.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      const x = startX + col * HORIZONTAL_NODE_GAP;
      const y = startY + row * VERTICAL_NODE_GAP;

      positions.set(layerNodes[i].id, { x, y });
      currentLayerPositions.set(layerNodes[i].id, i); // Track node position in this layer
    }

    previousLayerPositions = currentLayerPositions;
  }

  return positions;
}

// ── Helper: Check if filename suggests type-only import
function mightBeTypeImport(sourceId: string, targetId: string): boolean {
  const target = targetId.toLowerCase();
  return /\.(types?|model|entity|interface|dto)\.ts$/.test(target);
}

// ── Helper: Check if target is a safe external library
function isSafeExternalLib(targetId: string): boolean {
  const target = targetId.toLowerCase();
  for (const lib of SAFE_EXTERNAL_LIBS) {
    if (target.includes(lib)) return true;
  }
  return false;
}

// ── Helper: Check if transition is allowed
function isAllowedTransition(sourceLayer: ArchLayer, targetLayer: ArchLayer): boolean {
  const key = `${sourceLayer}→${targetLayer}`;
  return ALLOWED_TRANSITIONS.has(key);
}

// ── Violation Detection (now returns detailed violations with confidence) ────────
export function detectArchViolations(edges: GraphEdge[], nodeLayerMap: Map<string, ArchLayer>): Map<string, ArchViolation> {
  const violations = new Map<string, ArchViolation>();

  for (const edge of edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

    const sourceLayer = nodeLayerMap.get(sourceId) || 'external';
    const targetLayer = nodeLayerMap.get(targetId) || 'external';

    // Check Violation 1: Wrong-direction import (reverse dependency)
    // But allow if: type imports, safe external libs, or within same layer
    if (sourceLayer !== targetLayer && !isAllowedTransition(sourceLayer, targetLayer)) {
      let shouldFlag = true;
      let confidence = 0.9;
      let reason = `${sourceLayer} importing from ${targetLayer}`;
      let suggestion: string | undefined;

      // Reduce confidence for type imports (likely false positive)
      if (mightBeTypeImport(sourceId, targetId)) {
        confidence = 0.3;
        reason = `Type import from ${targetLayer} (low confidence)`;
      }

      // Reduce confidence for safe external libs
      else if (targetLayer === 'external' && isSafeExternalLib(targetId)) {
        shouldFlag = false;
      }

      if (shouldFlag) {
        violations.set(edgeId(sourceId, targetId), {
          edgeId: edgeId(sourceId, targetId),
          sourceId,
          targetId,
          sourceLayer,
          targetLayer,
          type: 'reverse-dependency',
          severity: confidence > 0.7 ? 'error' : confidence > 0.4 ? 'warning' : 'info',
          confidence,
          reason,
          suggestion: `Consider moving ${sourceId.split('/').pop()} or using dependency injection`,
        });
      }
    }

    // Check Violation 2: Core layers depending on non-safe external
    if ((sourceLayer === 'domain' || sourceLayer === 'service') && targetLayer === 'external') {
      if (!isSafeExternalLib(targetId)) {
        violations.set(edgeId(sourceId, targetId), {
          edgeId: edgeId(sourceId, targetId),
          sourceId,
          targetId,
          sourceLayer,
          targetLayer,
          type: 'external-from-core',
          severity: 'warning',
          confidence: 0.8,
          reason: `Core layer (${sourceLayer}) depends on external: ${targetId.split('/').pop()}`,
          suggestion: `Wrap external lib in an adapter (infrastructure layer) and inject it`,
        });
      }
    }

    // Check Violation 3: Circular dependencies across layers (higher confidence)
    if (edge.type === 'circular' && sourceLayer !== targetLayer) {
      violations.set(edgeId(sourceId, targetId), {
        edgeId: edgeId(sourceId, targetId),
        sourceId,
        targetId,
        sourceLayer,
        targetLayer,
        type: 'cross-layer-cycle',
        severity: 'error',
        confidence: 0.95,
        reason: `Circular dependency detected across ${sourceLayer} and ${targetLayer} layers`,
        suggestion: `Break the cycle by extracting shared types or using dependency inversion`,
      });
    }
  }

  return violations;
}

// ── Layer Band Geometry ────────────────────────────────────────
export function getLayerBands(
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
  nodeLayerMap: Map<string, ArchLayer>,
  archMapping?: ArchMapping
): LayerBand[] {
  const layerOrder = getLayerOrder(archMapping);
  // Find layer colors from archMapping or LAYER_CONFIG
  const layerColorMap = new Map<string, { label: string; color: string }>();
  if (archMapping) {
    for (const layer of archMapping.layers) {
      layerColorMap.set(layer.id, { label: layer.label, color: layer.color });
    }
  } else {
    for (const config of LAYER_CONFIG) {
      layerColorMap.set(config.id, { label: config.label, color: config.color });
    }
  }

  const bands: LayerBand[] = [];

  for (const layer of layerOrder) {
    const layerNodes = nodes.filter(n => (nodeLayerMap.get(n.id) || 'external') === layer);
    if (layerNodes.length === 0) continue;

    const layerIndex = layerOrder.indexOf(layer);
    const layerInfo = layerColorMap.get(layer);
    if (!layerInfo) continue;

    // Get position bounds from node positions
    const xs = layerNodes.map(n => positions.get(n.id)?.x || 0).filter(x => x !== undefined);
    const ys = layerNodes.map(n => positions.get(n.id)?.y || 0).filter(y => y !== undefined);

    const minX = Math.min(...xs) - NODE_WIDTH / 2 - LAYER_PADDING * 1.5;
    const maxX = Math.max(...xs) + NODE_WIDTH / 2 + LAYER_PADDING * 1.5;
    const minY = Math.min(...ys) - NODE_HEIGHT / 2 - LAYER_PADDING;
    const maxY = Math.max(...ys) + NODE_HEIGHT / 2 + LAYER_PADDING;

    bands.push({
      layer,
      label: layerInfo.label,
      color: layerInfo.color,
      x: minX,
      width: maxX - minX,
      minY,
      maxY,
      height: maxY - minY,
    });
  }

  return bands;
}

// ── Build Layer Map ───────────────────────────────────────────
export function buildNodeLayerMap(
  nodes: GraphNode[],
  archMapping?: ArchMapping
): Map<string, ArchLayer> {
  const map = new Map<string, ArchLayer>();
  const fileMap = archMapping ? { ...archMapping.files, ...archMapping.overrides } : undefined;
  // Only use pattern-based config if no archMapping provided (fileMap is direct mapping)
  const layerConfigs = archMapping ? [] : LAYER_CONFIG;

  for (const node of nodes) {
    map.set(node.id, classifyNodeToLayer(node.id, fileMap, layerConfigs));
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

export const ARCH_CANVAS_PADDING = { x: LAYER_PADDING, y: LAYER_PADDING };
