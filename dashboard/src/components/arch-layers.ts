import { GraphNode, GraphEdge, ArchMapping, ArchConnection } from '../types';
import { edgeId } from './graph-utils';
import {
  ARCH_HEADER_HEIGHT,
  LAYER_PADDING,
  buildLayerInfoMap,
  computeArchLayout,
  type LayerGeometry,
} from './arch-rendering';

// ── Layer Types ────────────────────────────────────────────────
export type ArchLayer = string;
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
  confidence: number;
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

// ── Allowed Transitions ─────────────────────────────────────────
// Order-derived (transitive): outer can depend on any more-inner layer.
function buildAllowedTransitions(layerOrder: ArchLayer[]): Set<string> {
  const transitions = new Set<string>();
  const orderMap = new Map<string, number>(layerOrder.map((id, i) => [id, i]));
  for (const source of layerOrder) {
    const sourceOrder = orderMap.get(source) ?? Infinity;
    for (const target of layerOrder) {
      const targetOrder = orderMap.get(target) ?? Infinity;
      if (source === target || targetOrder > sourceOrder) {
        transitions.add(`${source}→${target}`);
      }
    }
  }
  return transitions;
}

// Connection-derived (literal): only the explicit pairs + same-layer self-edges.
function buildAllowedTransitionsFromConnections(
  connections: ArchConnection[],
  layerOrder: ArchLayer[],
): Set<string> {
  const transitions = new Set<string>();
  for (const layer of layerOrder) transitions.add(`${layer}→${layer}`);
  for (const c of connections) transitions.add(`${c.from}→${c.to}`);
  return transitions;
}

const DEFAULT_ALLOWED_TRANSITIONS = buildAllowedTransitions(DEFAULT_LAYER_ORDER);

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

function getLayerOrder(archMapping?: ArchMapping): ArchLayer[] {
  if (!archMapping) return DEFAULT_LAYER_ORDER;
  return [...archMapping.layers].sort((a, b) => a.order - b.order).map(l => l.id);
}

// ── Allowed-transition check ────────────────────────────────────
// Priority: connections (literal) → layerOrder (transitive) → default.
function isAllowedTransition(
  sourceLayer: ArchLayer,
  targetLayer: ArchLayer,
  layerOrder?: ArchLayer[],
  connections?: ArchConnection[],
): boolean {
  if (sourceLayer === targetLayer) return true;
  if (connections && connections.length > 0 && layerOrder) {
    const set = buildAllowedTransitionsFromConnections(connections, layerOrder);
    return set.has(`${sourceLayer}→${targetLayer}`);
  }
  if (layerOrder) {
    const orderMap = new Map(layerOrder.map((id, i) => [id, i]));
    const sourceOrder = orderMap.get(sourceLayer) ?? Infinity;
    const targetOrder = orderMap.get(targetLayer) ?? Infinity;
    return targetOrder > sourceOrder;
  }
  return DEFAULT_ALLOWED_TRANSITIONS.has(`${sourceLayer}→${targetLayer}`);
}

function mightBeTypeImport(_sourceId: string, targetId: string): boolean {
  return /\.(types?|model|entity|interface|dto)\.ts$/.test(targetId.toLowerCase());
}

function isSafeExternalLib(targetId: string): boolean {
  const target = targetId.toLowerCase();
  for (const lib of SAFE_EXTERNAL_LIBS) {
    if (target.includes(lib)) return true;
  }
  return false;
}

// ── Violation Detection ────────────────────────────────────────
export function detectArchViolations(
  edges: GraphEdge[],
  nodeLayerMap: Map<string, ArchLayer>,
  layerOrder?: ArchLayer[],
  connections?: ArchConnection[],
): Map<string, ArchViolation> {
  const violations = new Map<string, ArchViolation>();
  const coreLayers = layerOrder
    ? new Set(layerOrder.slice(Math.ceil(layerOrder.length / 2)))
    : new Set(['domain', 'entity']);

  for (const edge of edges) {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    const sourceLayer = nodeLayerMap.get(sourceId) || 'external';
    const targetLayer = nodeLayerMap.get(targetId) || 'external';

    if (sourceLayer !== targetLayer && !isAllowedTransition(sourceLayer, targetLayer, layerOrder, connections)) {
      let shouldFlag = true;
      let confidence = 0.9;
      let reason = `${sourceLayer} importing from ${targetLayer}`;

      if (mightBeTypeImport(sourceId, targetId)) {
        confidence = 0.3;
        reason = `Type import from ${targetLayer} (low confidence)`;
      } else if (targetLayer === 'external' && isSafeExternalLib(targetId)) {
        shouldFlag = false;
      }

      if (shouldFlag) {
        violations.set(edgeId(sourceId, targetId), {
          edgeId: edgeId(sourceId, targetId), sourceId, targetId, sourceLayer, targetLayer,
          type: 'reverse-dependency',
          severity: confidence > 0.7 ? 'error' : confidence > 0.4 ? 'warning' : 'info',
          confidence, reason,
          suggestion: `Consider moving ${sourceId.split('/').pop()} or using dependency injection`,
        });
      }
    }

    if (coreLayers.has(sourceLayer) && targetLayer === 'external' && !isSafeExternalLib(targetId)) {
      violations.set(edgeId(sourceId, targetId), {
        edgeId: edgeId(sourceId, targetId), sourceId, targetId, sourceLayer, targetLayer,
        type: 'external-from-core', severity: 'warning', confidence: 0.8,
        reason: `Core layer (${sourceLayer}) depends on external: ${targetId.split('/').pop()}`,
        suggestion: `Wrap external lib in an adapter (infrastructure layer) and inject it`,
      });
    }

    if (edge.type === 'circular' && sourceLayer !== targetLayer) {
      violations.set(edgeId(sourceId, targetId), {
        edgeId: edgeId(sourceId, targetId), sourceId, targetId, sourceLayer, targetLayer,
        type: 'cross-layer-cycle', severity: 'error', confidence: 0.95,
        reason: `Circular dependency detected across ${sourceLayer} and ${targetLayer} layers`,
        suggestion: `Break the cycle by extracting shared types or using dependency inversion`,
      });
    }
  }

  return violations;
}

// ── Layout & Bands (delegate to arch-rendering) ────────────────
export function computeArchLayerPositions(
  nodes: GraphNode[],
  archMapping?: ArchMapping,
  edges?: GraphEdge[],
): Map<string, { x: number; y: number }> {
  return computeArchLayoutInternal(nodes, archMapping, edges).layout.positions;
}

export function getLayerBands(
  nodes: GraphNode[],
  _positions: Map<string, { x: number; y: number }>,
  nodeLayerMap: Map<string, ArchLayer>,
  archMapping?: ArchMapping,
): LayerBand[] {
  const layout = computeArchLayoutCached(nodes, nodeLayerMap, archMapping);
  const bands: LayerBand[] = [];
  for (const geom of layout.geometry.values()) {
    bands.push({
      layer: geom.layer, label: geom.label, color: geom.color,
      x: geom.centerX - geom.width / 2,
      width: geom.width,
      minY: layout.globalMinY,
      maxY: layout.globalMaxY,
      height: layout.globalMaxY - layout.globalMinY,
    });
  }
  return bands;
}

// Public: returns the full layout (positions + per-layer geometry) so the
// renderer can draw container boxes without recomputing layout.
export function computeFullArchLayout(
  nodes: GraphNode[],
  archMapping?: ArchMapping,
  edges?: GraphEdge[],
): {
  positions: Map<string, { x: number; y: number }>;
  geometry: Map<ArchLayer, LayerGeometry>;
  globalMinY: number;
  globalMaxY: number;
} {
  return computeArchLayoutInternal(nodes, archMapping, edges).layout;
}

function computeArchLayoutInternal(
  nodes: GraphNode[],
  archMapping?: ArchMapping,
  edges?: GraphEdge[],
) {
  const layerOrder = getLayerOrder(archMapping);
  const nodeLayerMap = buildNodeLayerMap(nodes, archMapping);
  const layerInfo = buildLayerInfoMap(archMapping, LAYER_CONFIG);
  const layout = computeArchLayout(nodes, layerOrder, nodeLayerMap, edges ?? [], layerInfo);
  return { layout, nodeLayerMap };
}

function computeArchLayoutCached(
  nodes: GraphNode[],
  nodeLayerMap: Map<string, ArchLayer>,
  archMapping?: ArchMapping,
) {
  const layerOrder = getLayerOrder(archMapping);
  const layerInfo = buildLayerInfoMap(archMapping, LAYER_CONFIG);
  return computeArchLayout(nodes, layerOrder, nodeLayerMap, [], layerInfo);
}

// ── Build Layer Map ───────────────────────────────────────────
export function buildNodeLayerMap(
  nodes: GraphNode[],
  archMapping?: ArchMapping,
): Map<string, ArchLayer> {
  const map = new Map<string, ArchLayer>();
  const fileMap = archMapping ? { ...archMapping.files, ...archMapping.overrides } : undefined;
  const layerConfigs = archMapping ? [] : LAYER_CONFIG;

  // When fileMap exists but keys are relative paths and node IDs are absolute,
  // pre-build a suffix lookup: longest key first to avoid false matches.
  const suffixEntries = fileMap
    ? Object.entries(fileMap).sort((a, b) => b[0].length - a[0].length)
    : undefined;

  for (const node of nodes) {
    let layer = classifyNodeToLayer(node.id, fileMap, layerConfigs);
    // fileMap present but direct lookup failed → try matching by relative-path suffix
    // (handles daemon sending absolute paths while arch.json stores relative paths)
    if (layer === 'unknown' && suffixEntries) {
      for (const [relPath, mappedLayer] of suffixEntries) {
        if (node.id.endsWith('/' + relPath)) {
          layer = mappedLayer;
          break;
        }
      }
    }
    map.set(node.id, layer);
  }
  return map;
}

export function getViolationSourceNodes(
  violations: Map<string, ArchViolation>,
): Set<string> {
  const sourceNodes = new Set<string>();
  for (const violation of violations.values()) {
    sourceNodes.add(violation.sourceId);
  }
  return sourceNodes;
}

// ── Re-exported style constants (back-compat) ─────────────────
export {
  ARCH_VIOLATION_EDGE_STYLE,
  ARCH_ALLOWED_EDGE_STYLE,
  ARCH_HEADER_HEIGHT,
} from './arch-rendering';
export { ARCH_VIOLATION_NODE_BORDER, ARCH_VIOLATION_NODE_BORDER_WIDTH } from './arch-rendering';

export const ARCH_CANVAS_PADDING = { x: LAYER_PADDING, y: LAYER_PADDING };
