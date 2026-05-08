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

// ── Clean Architecture Layer Configuration ─────────────────────
// Matches the layers defined in arch.json (Clean Architecture):
//   application → interface → usecase → domain → entity → data → infrastructure
// Dependencies flow inward: outer layers depend on inner layers.
export const LAYER_CONFIG: LayerConfig[] = [
  {
    id: 'application',
    label: 'Application Layer',
    folderPatterns: ['app', 'application', 'main', 'startup', 'program'],
    filePatterns: [/\.app\.tsx?$/, /^main\.tsx?$/, /^app\.tsx?$/, /^index\.tsx?$/],
    color: 'rgba(219, 39, 119, 0.08)',
    order: 0,
  },
  {
    id: 'interface',
    label: 'Interface Layer',
    folderPatterns: ['api', 'controllers', 'routes', 'handlers', 'mcp', 'hook-receiver', 'components', 'icons'],
    filePatterns: [/\.controller\.ts$/, /\.route\.ts$/, /\.handler\.ts$/, /\.endpoint\.ts$/, /\.component\.tsx?$/, /\.modal\.tsx?$/, /\.panel\.tsx?$/],
    color: 'rgba(234, 179, 8, 0.08)',
    order: 1,
  },
  {
    id: 'usecase',
    label: 'Use Case Layer',
    folderPatterns: ['usecases', 'use-cases', 'services', 'daemon', 'viz', 'hooks', 'utils'],
    filePatterns: [/\.service\.ts$/, /\.usecase\.ts$/, /\.use-case\.ts$/, /^use[A-Z].*\.tsx?$/, /\.tsx?$/],
    color: 'rgba(59, 130, 246, 0.08)',
    order: 2,
  },
  {
    id: 'domain',
    label: 'Domain Layer',
    folderPatterns: ['domain', 'types', 'models', 'rating', 'context'],
    filePatterns: [/\.domain\.ts$/, /\.model\.ts$/, /types\.ts$/, /^types\.tsx?$/, /\.context\.tsx?$/, /\.interface\.ts$/],
    color: 'rgba(34, 197, 94, 0.08)',
    order: 3,
  },
  {
    id: 'entity',
    label: 'Entity Layer',
    folderPatterns: ['entities', 'analyzer'],
    filePatterns: [/\.entity\.ts$/, /-analyzer\.ts$/, /\.analyzer\.ts$/],
    color: 'rgba(16, 185, 129, 0.08)',
    order: 4,
  },
  {
    id: 'data',
    label: 'Data Layer',
    folderPatterns: ['cache', 'repository', 'persistence', 'database', 'graph'],
    filePatterns: [/\.repository\.ts$/, /\.cache\.ts$/, /\.db\.ts$/, /\.storage\.ts$/],
    color: 'rgba(245, 158, 11, 0.08)',
    order: 5,
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure Layer',
    folderPatterns: ['infrastructure', 'config', 'setup', 'scripts', 'vite'],
    filePatterns: [/\.config\.ts$/, /\.setup\.ts$/, /\.infrastructure\.ts$/, /\.conf\.ts$/, /^vite\.config\.ts$/, /jest\.config\.js$/],
    color: 'rgba(239, 68, 68, 0.08)',
    order: 6,
  },
];

const DEFAULT_LAYER_ORDER: ArchLayer[] = ['application', 'interface', 'usecase', 'domain', 'entity', 'data', 'infrastructure', 'external'];

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

// ── Dynamic Allowed Transitions ─────────────────────────────────
// In Clean Architecture, dependencies flow inward:
//   application → interface → usecase → domain → entity → data → infrastructure
// A layer may depend on any layer with a HIGHER order (more inner).
// Same-layer dependencies are always allowed.
function buildAllowedTransitions(layerOrder: ArchLayer[]): Set<string> {
  const transitions = new Set<string>();
  const orderMap = new Map<string, number>(layerOrder.map((id, i) => [id, i]));
  for (const source of layerOrder) {
    const sourceOrder = orderMap.get(source) ?? Infinity;
    for (const target of layerOrder) {
      const targetOrder = orderMap.get(target) ?? Infinity;
      // Same layer always allowed; outer → inner allowed (higher order = more inner)
      if (source === target || targetOrder > sourceOrder) {
        transitions.add(`${source}→${target}`);
      }
    }
  }
  return transitions;
}

// Default allowed transitions based on DEFAULT_LAYER_ORDER
const DEFAULT_ALLOWED_TRANSITIONS = buildAllowedTransitions(DEFAULT_LAYER_ORDER);

// ── Layout Constants (Vertical Column Swimlane Layout) ────────
const LAYER_COLUMN_SPACING = 280; // X center-to-center between layer columns
const NODE_VERTICAL_GAP = 110;    // Y spacing between stacked nodes in a column
const NODE_HEIGHT = 60;
const LAYER_PADDING = 60;         // Padding inside each column band
export const ARCH_HEADER_HEIGHT = 36; // Height of the label header at top of each column

// ── Classification Logic ───────────────────────────────────────
export function classifyNodeToLayer(
  nodeId: string,
  fileMap?: Record<string, string>,
  layerConfigs: LayerConfig[] = LAYER_CONFIG
): ArchLayer {
  if (fileMap && fileMap[nodeId]) return fileMap[nodeId];
  if (fileMap) return 'unknown';

  const lower = nodeId.toLowerCase();
  const parts = lower.split('/');
  const filename = parts[parts.length - 1];

  for (const config of layerConfigs) {
    if (config.folderPatterns) {
      for (const pattern of config.folderPatterns) {
        if (parts.some(part => part === pattern)) return config.id;
      }
    }
  }

  for (const config of layerConfigs) {
    if (config.filePatterns) {
      for (const pattern of config.filePatterns) {
        if (pattern.test(filename)) return config.id;
      }
    }
  }

  return 'external';
}

// ── Helper: Get layer order from archMapping or default ────────
function getLayerOrder(archMapping?: ArchMapping): ArchLayer[] {
  if (!archMapping) return DEFAULT_LAYER_ORDER;
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

  const edgeMap = new Map<string, string[]>();
  for (const edge of edges) {
    const from = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const to = typeof edge.target === 'string' ? edge.target : edge.target.id;
    if (!edgeMap.has(from)) edgeMap.set(from, []);
    edgeMap.get(from)!.push(to);
    if (!edgeMap.has(to)) edgeMap.set(to, []);
    edgeMap.get(to)!.push(from);
  }

  if (adjacentLayerPositions.size === 0) return layerNodes;

  const barycenters = new Map<string, number>();
  for (const node of layerNodes) {
    const neighbors = edgeMap.get(node.id) || [];
    const positions = neighbors
      .map(nid => adjacentLayerPositions.get(nid))
      .filter((p): p is number => p !== undefined);
    barycenters.set(node.id, positions.length > 0
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : 0);
  }

  return [...layerNodes].sort((a, b) => (barycenters.get(a.id) || 0) - (barycenters.get(b.id) || 0));
}

// Lays out layers as vertical columns (left → right by order).
export function computeArchLayerPositions(
  nodes: GraphNode[],
  archMapping?: ArchMapping,
  edges?: GraphEdge[]
): Map<string, { x: number; y: number }> {
  const layerOrder = getLayerOrder(archMapping);
  const fileMap = archMapping ? { ...archMapping.files, ...archMapping.overrides } : undefined;
  const layerConfigs = archMapping ? (archMapping.layers as LayerConfig[]) : LAYER_CONFIG;
  const layerMap = new Map<ArchLayer, GraphNode[]>();

  for (const layer of layerOrder) layerMap.set(layer, []);
  if (!layerMap.has('external')) layerMap.set('external', []);

  for (const node of nodes) {
    const layer = classifyNodeToLayer(node.id, fileMap, layerConfigs);
    const bucket = layerMap.get(layer) || layerMap.get('external')!;
    bucket.push(node);
  }

  const positions = new Map<string, { x: number; y: number }>();
  let previousLayerPositions = new Map<string, number>();

  const nonEmptyLayers = layerOrder.filter(l => (layerMap.get(l) || []).length > 0);

  for (let colIdx = 0; colIdx < nonEmptyLayers.length; colIdx++) {
    const layer = nonEmptyLayers[colIdx];
    let layerNodes = layerMap.get(layer) || [];
    if (layerNodes.length === 0) continue;

    if (edges && edges.length > 0 && previousLayerPositions.size > 0) {
      layerNodes = orderNodesInLayer(layerNodes, edges, previousLayerPositions);
    }

    const centerX = colIdx * LAYER_COLUMN_SPACING;
    const totalHeight = (layerNodes.length - 1) * NODE_VERTICAL_GAP;
    const startY = -totalHeight / 2;
    const currentLayerPositions = new Map<string, number>();

    for (let i = 0; i < layerNodes.length; i++) {
      positions.set(layerNodes[i].id, {
        x: centerX,
        y: startY + i * NODE_VERTICAL_GAP,
      });
      currentLayerPositions.set(layerNodes[i].id, i);
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
// Uses dynamic layer ordering: a layer may depend on any layer with a higher order (more inner).
// Falls back to DEFAULT_ALLOWED_TRANSITIONS if no layer order is provided.
function isAllowedTransition(
  sourceLayer: ArchLayer,
  targetLayer: ArchLayer,
  layerOrder?: ArchLayer[],
): boolean {
  if (layerOrder) {
    const orderMap = new Map(layerOrder.map((id, i) => [id, i]));
    const sourceOrder = orderMap.get(sourceLayer) ?? Infinity;
    const targetOrder = orderMap.get(targetLayer) ?? Infinity;
    // Same layer or outer → inner (higher order = more inner)
    return sourceLayer === targetLayer || targetOrder > sourceOrder;
  }
  const key = `${sourceLayer}→${targetLayer}`;
  return DEFAULT_ALLOWED_TRANSITIONS.has(key);
}

// ── Violation Detection (now returns detailed violations with confidence) ────────
export function detectArchViolations(
  edges: GraphEdge[],
  nodeLayerMap: Map<string, ArchLayer>,
  layerOrder?: ArchLayer[],
): Map<string, ArchViolation> {
  const violations = new Map<string, ArchViolation>();

  // Determine which layers are "core" (the innermost half of the layer stack)
  const coreLayers = layerOrder
    ? new Set(layerOrder.slice(Math.ceil(layerOrder.length / 2)))
    : new Set(['domain', 'entity']);

  for (const edge of edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

    const sourceLayer = nodeLayerMap.get(sourceId) || 'external';
    const targetLayer = nodeLayerMap.get(targetId) || 'external';

    // Check Violation 1: Wrong-direction import (reverse dependency)
    // But allow if: type imports, safe external libs, or within same layer
    if (sourceLayer !== targetLayer && !isAllowedTransition(sourceLayer, targetLayer, layerOrder)) {
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
    if (coreLayers.has(sourceLayer) && targetLayer === 'external') {
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
// Each band is a vertical column: layers get individual X ranges,
// all share the same global Y span so columns extend to the same height.
export function getLayerBands(
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
  nodeLayerMap: Map<string, ArchLayer>,
  archMapping?: ArchMapping
): LayerBand[] {
  const layerOrder = getLayerOrder(archMapping);
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

  const nonEmptyLayers = layerOrder.filter(l =>
    nodes.some(n => (nodeLayerMap.get(n.id) || 'external') === l)
  );

  // All columns share the same global Y extent
  const allYs = Array.from(positions.values()).map(p => p.y);
  const globalMinY = allYs.length > 0 ? Math.min(...allYs) - NODE_HEIGHT / 2 - LAYER_PADDING : -300;
  const globalMaxY = allYs.length > 0 ? Math.max(...allYs) + NODE_HEIGHT / 2 + LAYER_PADDING : 300;
  const globalHeight = globalMaxY - globalMinY;

  const bands: LayerBand[] = [];
  const halfSpacing = LAYER_COLUMN_SPACING / 2;

  for (let colIdx = 0; colIdx < nonEmptyLayers.length; colIdx++) {
    const layer = nonEmptyLayers[colIdx];
    const layerInfo = layerColorMap.get(layer);
    if (!layerInfo) continue;

    const centerX = colIdx * LAYER_COLUMN_SPACING;
    bands.push({
      layer,
      label: layerInfo.label,
      color: layerInfo.color,
      x: centerX - halfSpacing,
      width: LAYER_COLUMN_SPACING,
      minY: globalMinY,
      maxY: globalMaxY,
      height: globalHeight,
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

// ── Violation Source Nodes ─────────────────────────────────────
// Returns the set of node IDs that are the *source* of at least one
// arch violation (i.e., nodes that import from a layer they shouldn't).
export function getViolationSourceNodes(
  violations: Map<string, ArchViolation>
): Set<string> {
  const sourceNodes = new Set<string>();
  for (const violation of violations.values()) {
    sourceNodes.add(violation.sourceId);
  }
  return sourceNodes;
}

// ── Styling Constants ──────────────────────────────────────────
export const ARCH_VIOLATION_EDGE_STYLE = {
  color: '#ef4444',
  highlightColor: '#dc2626',
  width: 2.5,
  dashes: [4, 4],
} as const;

export const ARCH_VIOLATION_NODE_BORDER = '#ef4444'; // Red warning border for violation source nodes
export const ARCH_VIOLATION_NODE_BORDER_WIDTH = 3;

export const ARCH_CANVAS_PADDING = { x: LAYER_PADDING, y: LAYER_PADDING };
