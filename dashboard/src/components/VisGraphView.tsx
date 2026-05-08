import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Network } from 'vis-network/standalone';
import { DataSet } from 'vis-data/standalone';
import { GraphData, GraphNode, ArchMapping } from '../types';
import { useTheme } from '../ThemeContext';
import {
  healthColor,
  makeNodeColor,
  buildVisNodes,
  buildVisEdges,
  computeHierarchicalPositions,
} from './graph-utils';
import {
  computeArchLayerPositions,
  detectArchViolations,
  buildNodeLayerMap,
  getLayerBands,
  getViolationSourceNodes,
  ARCH_VIOLATION_EDGE_STYLE,
  ARCH_VIOLATION_NODE_BORDER,
  ARCH_VIOLATION_NODE_BORDER_WIDTH,
  ARCH_CANVAS_PADDING,
  type ArchViolation,
  type ViolationType,
} from './arch-layers';

// ── Props ──────────────────────────────────────────────────
interface VisGraphViewProps {
  graphData: GraphData;
  onNodeClick: (node: GraphNode) => void;
  onCanvasClick: () => void;
  highlightNodeId?: string;
  selectedRepo: string | null;
  focusNodeId?: string | null;
  fitTrigger?: number;
  scanning?: boolean;
  archConfig?: ArchMapping | null;
}

// ── Vis-Network Data Types ─────────────────────────────────
interface VisNodeData {
  id: string;
  x?: number;
  y?: number;
  color?: {
    background: string;
    border: string;
    highlight?: { background: string; border: string };
    hover?: { background: string; border: string };
  };
  borderWidth?: number;
  physics?: boolean;
  font?: { color: string; size: number; face: string };
}

interface VisEdgeData {
  id: string;
  color?: { color: string; highlight: string };
  width?: number;
  _isCircular?: boolean;
  dashes?: boolean | number[];
  _violation?: ArchViolation;
}

interface NetworkRefs {
  containerRef: React.RefObject<HTMLDivElement>;
  networkRef: React.RefObject<Network | undefined>;
  nodesDS: React.RefObject<DataSet<VisNodeData>>;
  edgesDS: React.RefObject<DataSet<VisEdgeData>>;
  pinnedRef: React.RefObject<Map<string, { x: number; y: number }>>;
  treePositionsRef: React.RefObject<Map<string, { x: number; y: number }>>;
}

// ── Setup shared refs ──────────────────────────────────────
function useNetworkRefs(params: VisGraphViewProps): NetworkRefs {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | undefined>(undefined);
  const nodesDS = useRef<DataSet<VisNodeData>>(new DataSet<VisNodeData>());
  const edgesDS = useRef<DataSet<VisEdgeData>>(new DataSet<VisEdgeData>());
  const pinnedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const treePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  return { containerRef, networkRef, nodesDS, edgesDS, pinnedRef, treePositionsRef };
}

// ── Load and persist positions ──────────────────────────────
function usePositionPersistence(refs: NetworkRefs, selectedRepo: string | null) {
  useEffect(() => {
    if (!selectedRepo) { refs.pinnedRef.current.clear(); return; }
    fetch(`/api/positions?repo=${encodeURIComponent(selectedRepo)}`)
      .then(r => r.json())
      .then((data: Array<{ nodeId: string; x: number; y: number }>) => {
        refs.pinnedRef.current.clear();
        for (const p of data) refs.pinnedRef.current.set(p.nodeId, { x: p.x, y: p.y });
      })
      .catch(() => { /* network errors are acceptable */ });
  }, [selectedRepo, refs.pinnedRef]);
}

// ── Sync node and edge updates ────────────────────────────
function useSyncGraphData(
  refs: NetworkRefs,
  graphData: GraphData,
  T: ReturnType<typeof useTheme>['T'],
  archMode?: boolean,
  violationTypeFilters?: Record<ViolationType, boolean>,
  minConfidence?: number,
  archConfig?: ArchMapping | null,
  violationOnly?: boolean,
) {
  const LARGE_GRAPH_THRESHOLD = 200;
  // Provide defaults if not passed
  const filters = violationTypeFilters || {
    'reverse-dependency': true,
    'external-from-core': true,
    'cross-layer-cycle': true,
  };
  const minConf = minConfidence ?? 0.4;

  useEffect(() => {
    const isLarge = graphData.nodes.length > LARGE_GRAPH_THRESHOLD;
    const positions = archMode
      ? computeArchLayerPositions(graphData.nodes, archConfig || undefined, graphData.edges)
      : isLarge
      ? new Map()
      : computeHierarchicalPositions(graphData.nodes, graphData.edges);
    refs.treePositionsRef.current.clear();
    for (const [k, v] of positions) refs.treePositionsRef.current.set(k, v);

    const visNodes = buildVisNodes(graphData.nodes, refs.pinnedRef.current, refs.treePositionsRef.current, T);
    const currentIds = new Set(refs.nodesDS.current.getIds() as string[]);
    const newIds = new Set(visNodes.map(n => n.id as string));

    if (isLarge || currentIds.size === 0) {
      refs.nodesDS.current.clear();
      refs.nodesDS.current.add(visNodes);
    } else {
      for (const id of currentIds) {
        if (!newIds.has(id)) { refs.nodesDS.current.remove(id); refs.pinnedRef.current.delete(id); }
      }
      for (const vn of visNodes) {
        const existing = refs.nodesDS.current.get(vn.id) as unknown as VisNodeData | undefined;
        if (existing && refs.pinnedRef.current.has(vn.id)) {
          refs.nodesDS.current.update({ ...vn, x: existing.x, y: existing.y });
        } else {
          refs.nodesDS.current.update(vn);
        }
      }
    }
  }, [graphData.nodes, graphData.edges, T, refs, archMode, archConfig]);

  useEffect(() => {
    refs.edgesDS.current.clear();
    const visEdges = buildVisEdges(graphData, T) as VisEdgeData[];

    // Apply arch violation styling if in arch mode
    if (archMode) {
      const nodeLayerMap = buildNodeLayerMap(graphData.nodes, archConfig || undefined);
      const layerOrder = archConfig?.layers?.sort((a, b) => a.order - b.order).map(l => l.id);
      const allViolations = detectArchViolations(graphData.edges, nodeLayerMap, layerOrder);

      // Filter violations by type and confidence threshold
      const filteredViolations = new Map(
        Array.from(allViolations.entries()).filter(([, violation]) =>
          filters[violation.type] && violation.confidence >= minConf
        )
      );

      for (const edge of visEdges) {
        if (filteredViolations.has(edge.id)) {
          const violation = filteredViolations.get(edge.id)!;
          // Color by severity: error=red, warning=orange, info=yellow
          const severityColor = violation.severity === 'error' ? '#ef4444' : violation.severity === 'warning' ? '#f97316' : '#eab308';
          edge.color = { color: severityColor, highlight: '#dc2626' };
          edge.width = 2.5;
          edge.dashes = [4, 4];
          edge._violation = violation;
        } else if (violationOnly) {
          // In violation-only mode, dim all non-violation edges
          edge.color = { color: T.edgeDim, highlight: T.edgeDim };
          edge.width = 0.3;
          edge.dashes = false;
        }
      }
    }

    refs.edgesDS.current.add(visEdges);
  }, [graphData.edges, T, archMode, graphData.nodes, violationTypeFilters, minConfidence, violationOnly]);

  // Apply red warning borders to violation source nodes
  useEffect(() => {
    if (!archMode) return;

    const nodeLayerMap = buildNodeLayerMap(graphData.nodes, archConfig || undefined);
    const layerOrder = archConfig?.layers?.sort((a, b) => a.order - b.order).map(l => l.id);
    const allViolations = detectArchViolations(graphData.edges, nodeLayerMap, layerOrder);
    const filteredViolations = new Map(
      Array.from(allViolations.entries()).filter(([, violation]) =>
        filters[violation.type] && violation.confidence >= minConf
      )
    );
    const violationSourceNodes = getViolationSourceNodes(filteredViolations);

    // Update all nodes: apply red border to violation sources, restore normal for others
    const nodeUpdates = graphData.nodes.map(node => {
      if (violationSourceNodes.has(node.id)) {
        return {
          id: node.id,
          borderWidth: ARCH_VIOLATION_NODE_BORDER_WIDTH,
          color: {
            background: T.cardBg,
            border: ARCH_VIOLATION_NODE_BORDER,
            highlight: { background: T.cardBgHover, border: '#dc2626' },
            hover: { background: T.cardBgHover, border: ARCH_VIOLATION_NODE_BORDER },
          },
        };
      }
      return {
        id: node.id,
        borderWidth: 2,
        color: makeNodeColor(healthColor(node.rating, T)),
      };
    });
    refs.nodesDS.current.update(nodeUpdates);
  }, [graphData.nodes, graphData.edges, T, archMode, violationTypeFilters, minConfidence, archConfig]);
}

// ── Update interaction on scanning state
function useUpdateScanningInteraction(refs: React.RefObject<Network | undefined>, scanning?: boolean) {
  useEffect(() => {
    if (!refs.current) return;
    refs.current.setOptions({
      interaction: { dragView: !scanning }
    });
  }, [refs, scanning]);
}

// ── Focus and highlight node selection
function useNodeSelection(refs: NetworkRefs, graphData: GraphData, focusNodeId: string | null | undefined, highlightNodeId: string | undefined, T: ReturnType<typeof useTheme>['T']) {
  useEffect(() => {
    if (!refs.networkRef.current || !focusNodeId) return;
    refs.networkRef.current.selectNodes([focusNodeId], false);
  }, [focusNodeId, refs]);

  useEffect(() => {
    if (!highlightNodeId) return;
    const gn = graphData.nodes.find(n => n.id === highlightNodeId);
    if (gn) {
      refs.nodesDS.current.update({
        id: highlightNodeId,
        color: {
          background: T.cardBgHover,
          border: T.accent,
          highlight: { background: T.cardBgHover, border: T.accent },
          hover: { background: T.cardBgHover, border: T.accent }
        },
        borderWidth: 3,
      });
    }
    return () => {
      if (gn) {
        refs.nodesDS.current.update({
          id: highlightNodeId,
          color: makeNodeColor(healthColor(gn.rating, T)),
          borderWidth: 2,
        });
      }
    };
  }, [highlightNodeId, graphData.nodes, T, refs]);
}

// ── Initialize network instance ────────────────────────────
function useInitializeNetwork(refs: NetworkRefs, graphData: GraphData, params: VisGraphViewProps, T: ReturnType<typeof useTheme>['T'], archMode?: boolean, archConfig?: ArchMapping | null) {
  const graphDataRef = useRef(graphData);
  const onNodeClickRef = useRef(params.onNodeClick);
  const onCanvasClickRef = useRef(params.onCanvasClick);
  const selectedRepoRef = useRef(params.selectedRepo);
  const archModeRef = useRef(archMode);
  const archConfigRef = useRef(archConfig);

  useEffect(() => {
    graphDataRef.current = graphData;
    onNodeClickRef.current = params.onNodeClick;
    onCanvasClickRef.current = params.onCanvasClick;
    selectedRepoRef.current = params.selectedRepo;
    archModeRef.current = archMode;
    archConfigRef.current = archConfig;
  }, [graphData, params.onNodeClick, params.onCanvasClick, params.selectedRepo, archMode, archConfig]);

  useEffect(() => {
    if (!refs.containerRef.current || refs.networkRef.current) return;

    const network = new Network(refs.containerRef.current, {
      nodes: refs.nodesDS.current,
      edges: refs.edgesDS.current,
    }, {
      physics: { enabled: false },
      interaction: {
        hover: false,
        navigationButtons: false,
        zoomView: true,
        dragView: true,
        multiselect: false,
      },
      layout: { improvedLayout: false },
      nodes: {
        shape: 'box',
        font: {
          size: 14,
          face: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
          color: T.text,
          multi: false,
        },
        borderWidth: 2,
        borderWidthSelected: 3,
        margin: { top: 14, right: 18, bottom: 14, left: 18 },
        shapeProperties: { borderRadius: 8 },
        widthConstraint: { minimum: 100, maximum: 180 },
        chosen: true,
      },
      edges: {
        smooth: {
          enabled: true,
          type: 'curvedCW',
          forceDirection: 'vertical',
          roundness: 0.5,
        },
        arrows: { to: { enabled: true, scaleFactor: 0.4, type: 'arrow' } },
        hoverWidth: 1.5,
        selectionWidth: 2,
        color: { inherit: false },
        font: { color: 'transparent' },
      },
    });

    (refs.networkRef as React.MutableRefObject<Network | undefined>).current = network;

    let lastHoverUpdatedIds: string[] = [];
    let lastHoverEdgeIds: string[] = [];

    // Register beforeDrawing handler for arch layer swimlanes
    network.on('beforeDrawing', (ctx: CanvasRenderingContext2D) => {
      if (!archModeRef.current) return;

      const nodeLayerMap = buildNodeLayerMap(graphDataRef.current.nodes, archConfigRef.current || undefined);
      const bands = getLayerBands(graphDataRef.current.nodes, refs.treePositionsRef.current, nodeLayerMap, archConfigRef.current || undefined);

      for (const band of bands) {
        // Draw swimlane background
        ctx.fillStyle = band.color;
        ctx.fillRect(
          band.x - ARCH_CANVAS_PADDING.x,
          band.minY - ARCH_CANVAS_PADDING.y,
          band.width + ARCH_CANVAS_PADDING.x * 2,
          band.height + ARCH_CANVAS_PADDING.y * 2
        );

        // Draw layer label in top-left corner of the swimlane padding area
        ctx.fillStyle = T.textMuted;
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(band.label, band.x - ARCH_CANVAS_PADDING.x + 12, band.minY - ARCH_CANVAS_PADDING.y + 20);
      }
    });

    const eventHandlers = createNetworkEventHandlers(graphDataRef, onNodeClickRef, onCanvasClickRef, selectedRepoRef, refs, T);

    network.on('hoverNode', (hoverParams: { node: string }) => {
      const nodeId = hoverParams.node;
      const isLargeGraph = graphDataRef.current.nodes.length > 200;
      const connectedNodeIds = network.getConnectedNodes(nodeId) as string[];
      const connectedEdgeIds = network.getConnectedEdges(nodeId) as string[];
      // Build O(1) lookup map once per event instead of O(n) .find() per node
      const nodeById = new Map(graphDataRef.current.nodes.map(n => [n.id, n]));
      isLargeGraph
        ? handleLargeGraphHover(nodeId, connectedNodeIds, connectedEdgeIds, nodeById)
        : handleSmallGraphHover(nodeId, connectedNodeIds, connectedEdgeIds, nodeById);
    });

    network.on('blurNode', restoreStyles);
    network.on('click', eventHandlers.handleNodeClick);
    network.on('dragEnd', eventHandlers.handleNodeDragEnd);

    const fitTimer = setTimeout(() => {
      try {
        refs.networkRef.current?.fit({
          animation: { duration: 500, easingFunction: 'easeInOutQuad' },
          maxZoomLevel: 1.2,
          minZoomLevel: 0.15,
        });
      } catch { }
    }, 200);

    function handleLargeGraphHover(nodeId: string, connectedNodeIds: string[], connectedEdgeIds: string[], nodeById: Map<string, GraphNode>) {
      const touchedIds = [nodeId, ...connectedNodeIds];
      const nodeUpdates = touchedIds.map(id => {
        const gn = nodeById.get(id);
        const baseColor = healthColor(gn?.rating ?? 5, T);
        return {
          id,
          color: {
            background: id === nodeId ? T.cardBgHover : T.cardBg,
            border: id === nodeId ? T.accent : baseColor,
            highlight: { background: T.cardBgHover, border: T.accent },
            hover: { background: T.cardBgHover, border: baseColor },
          },
          borderWidth: id === nodeId ? 3 : 2,
        };
      });
      refs.nodesDS.current.update(nodeUpdates);

      const edgeUpdates = connectedEdgeIds.map(id => {
        const e = refs.edgesDS.current.get(id);
        const isCirc = e?._isCircular;
        return {
          id,
          color: { color: isCirc ? 'rgba(249,115,22,0.85)' : T.edgeHighlight, highlight: T.edgeHighlight },
          width: 2.5,
        };
      });
      refs.edgesDS.current.update(edgeUpdates);

      lastHoverUpdatedIds = touchedIds;
      lastHoverEdgeIds = connectedEdgeIds;
    }

    function handleSmallGraphHover(nodeId: string, connectedNodeIds: string[], connectedEdgeIds: string[], nodeById: Map<string, GraphNode>) {
      const connectedSet = new Set(connectedNodeIds);
      connectedSet.add(nodeId);
      const connectedEdgeSet = new Set(connectedEdgeIds);

      const allNodeIds = refs.nodesDS.current.getIds() as string[];
      const nodeUpdates = allNodeIds.map(id => {
        const gn = nodeById.get(id);
        const baseColor = healthColor(gn?.rating ?? 5, T);
        if (connectedSet.has(id)) {
          return {
            id,
            color: {
              background: id === nodeId ? T.cardBgHover : T.cardBg,
              border: id === nodeId ? T.accent : baseColor,
              highlight: { background: T.cardBgHover, border: T.accent },
              hover: { background: T.cardBgHover, border: baseColor },
            },
            font: { color: T.text, size: 14, face: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' },
            borderWidth: id === nodeId ? 3 : 2,
          };
        }
        return {
          id,
          color: {
            background: T.elevated,
            border: T.border,
            highlight: { background: T.cardBgHover, border: T.accent },
            hover: { background: T.cardBgHover, border: T.borderBright },
          },
          font: { color: T.textFaint, size: 14, face: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' },
          borderWidth: 1,
        };
      });
      refs.nodesDS.current.update(nodeUpdates);

      const allEdgeIds = refs.edgesDS.current.getIds() as string[];
      const edgeUpdates = allEdgeIds.map(id => {
        if (connectedEdgeSet.has(id)) {
          const e = refs.edgesDS.current.get(id);
          const isCirc = e?._isCircular;
          return {
            id,
            color: { color: isCirc ? 'rgba(249,115,22,0.85)' : T.edgeHighlight, highlight: T.edgeHighlight },
            width: 2.5,
          };
        }
        return {
          id,
          color: { color: T.edgeDim, highlight: T.edgeDim },
          width: 0.5,
        };
      });
      refs.edgesDS.current.update(edgeUpdates);
      lastHoverUpdatedIds = allNodeIds;
      lastHoverEdgeIds = allEdgeIds;
    }

    function restoreStyles() {
      const isLargeGraph = graphDataRef.current.nodes.length > 200;
      const nodeById = new Map(graphDataRef.current.nodes.map(n => [n.id, n]));

      if (isLargeGraph && lastHoverUpdatedIds.length > 0) {
        const nodeUpdates = lastHoverUpdatedIds.map(id => {
          const gn = nodeById.get(id);
          const color = healthColor(gn?.rating ?? 5, T);
          return { id, color: makeNodeColor(color), borderWidth: 2 };
        });
        refs.nodesDS.current.update(nodeUpdates);

        const edgeUpdates = lastHoverEdgeIds.map(id => {
          const e = refs.edgesDS.current.get(id);
          const isCirc = e?._isCircular;
          return {
            id,
            color: {
              color: isCirc ? T.edgeCircular : T.edgeDefault,
              highlight: isCirc ? 'rgba(249,115,22,1)' : T.edgeHighlight,
            },
            width: isCirc ? 2.5 : 2,
          };
        });
        refs.edgesDS.current.update(edgeUpdates);
        lastHoverUpdatedIds = [];
        lastHoverEdgeIds = [];
      } else {
        const allNodeIds = refs.nodesDS.current.getIds() as string[];
        const nodeUpdates = allNodeIds.map(id => {
          const gn = nodeById.get(id);
          const color = healthColor(gn?.rating ?? 5, T);
          return {
            id,
            color: makeNodeColor(color),
            font: { color: T.text, size: 14, face: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' },
            borderWidth: 2,
          };
        });
        refs.nodesDS.current.update(nodeUpdates);

        refs.edgesDS.current.clear();
        refs.edgesDS.current.add(buildVisEdges(graphDataRef.current, T));
      }
    }

    function handleNetworkClick(clickParams: { nodes: string[] }) {
      if (clickParams.nodes.length > 0) {
        const nodeId = clickParams.nodes[0];
        const gn = graphDataRef.current.nodes.find(n => n.id === nodeId);
        if (gn) onNodeClickRef.current(gn);
      } else {
        onCanvasClickRef.current();
      }
    }

    function handleNodeDragEnd(dragParams: { nodes: string[] }) {
      for (const nodeId of dragParams.nodes) {
        const node = refs.nodesDS.current.get(nodeId);
        if (!node) continue;
        const pos = { x: node.x as number, y: node.y as number };
        refs.pinnedRef.current.set(nodeId, pos);
        refs.nodesDS.current.update({ id: nodeId, physics: false });

        if (selectedRepoRef.current) {
          fetch('/api/positions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: selectedRepoRef.current, nodeId, ...pos }),
          }).catch(() => { });
        }
      }
    }

    return () => {
      clearTimeout(fitTimer);
      network.destroy();
      (refs.networkRef as React.MutableRefObject<Network | undefined>).current = undefined;
    };
  }, [T, graphData, archMode]);
}

// ── Zoom and network event handlers ────────────────────────
function createNetworkEventHandlers(
  graphDataRef: React.MutableRefObject<GraphData>,
  onNodeClickRef: React.MutableRefObject<(n: GraphNode) => void>,
  onCanvasClickRef: React.MutableRefObject<() => void>,
  selectedRepoRef: React.MutableRefObject<string | null>,
  refs: NetworkRefs,
  T: ReturnType<typeof useTheme>['T']
) {
  let lastHoverUpdatedIds: string[] = [];
  let lastHoverEdgeIds: string[] = [];

  return {
    handleNodeClick: (clickParams: { nodes: string[] }) => {
      if (clickParams.nodes.length > 0) {
        const nodeId = clickParams.nodes[0];
        const gn = graphDataRef.current.nodes.find(n => n.id === nodeId);
        if (gn) onNodeClickRef.current(gn);
      } else {
        onCanvasClickRef.current();
      }
    },
    handleNodeDragEnd: (dragParams: { nodes: string[] }) => {
      for (const nodeId of dragParams.nodes) {
        const node = refs.nodesDS.current.get(nodeId);
        if (!node) continue;
        const pos = { x: node.x as number, y: node.y as number };
        refs.pinnedRef.current.set(nodeId, pos);
        refs.nodesDS.current.update({ id: nodeId, physics: false });
        if (selectedRepoRef.current) {
          fetch('/api/positions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: selectedRepoRef.current, nodeId, ...pos }),
          }).catch(() => { /* network errors acceptable */ });
        }
      }
    },
  };
}

function createZoomHandlers(networkRef: React.RefObject<Network | undefined>) {
  return {
    handleZoomIn() {
      const net = networkRef.current; if (!net) return;
      const s = net.getScale(); const p = net.getViewPosition();
      net.moveTo({ position: p, scale: s * 1.3, animation: { duration: 200, easingFunction: 'easeInOutQuad' } });
    },
    handleZoomOut() {
      const net = networkRef.current; if (!net) return;
      const s = net.getScale(); const p = net.getViewPosition();
      net.moveTo({ position: p, scale: s * 0.77, animation: { duration: 200, easingFunction: 'easeInOutQuad' } });
    },
    handleFitView() {
      networkRef.current?.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' }, maxZoomLevel: 1 });
    }
  };
}

// ── Component ──────────────────────────────────────────────

export function VisGraphView({
  graphData,
  onNodeClick,
  onCanvasClick,
  highlightNodeId,
  selectedRepo,
  focusNodeId,
  fitTrigger,
  scanning,
  archConfig,
}: VisGraphViewProps) {
  const { T } = useTheme();
  const [archMode, setArchMode] = useState(false);
  const [violationOnly, setViolationOnly] = useState(false);
  const [violationTypeFilters, setViolationTypeFilters] = useState<Record<ViolationType, boolean>>({
    'reverse-dependency': true,
    'external-from-core': true,
    'cross-layer-cycle': true,
  });
  const [minConfidence, setMinConfidence] = useState(0.4); // Show all violations >= 40% confidence by default
  const refs = useNetworkRefs({ graphData, onNodeClick, onCanvasClick, highlightNodeId, selectedRepo, focusNodeId, fitTrigger });

  usePositionPersistence(refs, selectedRepo);
  useSyncGraphData(refs, graphData, T, archMode, violationTypeFilters, minConfidence, archConfig, violationOnly);
  useNodeSelection(refs, graphData, focusNodeId, highlightNodeId, T);
  useInitializeNetwork(refs, graphData, { graphData, onNodeClick, onCanvasClick, highlightNodeId, selectedRepo, focusNodeId, fitTrigger, scanning, archConfig }, T, archMode, archConfig);
  useUpdateScanningInteraction(refs.networkRef, scanning);

  const { handleZoomIn, handleZoomOut, handleFitView } = createZoomHandlers(refs.networkRef);

  // Stable callbacks for toggle buttons to avoid inline handler violations
  const handleToggleArchMode = useCallback(() => setArchMode(prev => !prev), []);
  const handleToggleViolationOnly = useCallback(() => setViolationOnly(prev => !prev), []);

  const handleArchBtnMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!archMode) e.currentTarget.style.background = T.cardBgHover;
  }, [archMode, T.cardBgHover]);
  const handleArchBtnMouseLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!archMode) e.currentTarget.style.background = T.panel;
  }, [archMode, T.panel]);
  const handleViolationBtnMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!violationOnly) e.currentTarget.style.background = T.cardBgHover;
  }, [violationOnly, T.cardBgHover]);
  const handleViolationBtnMouseLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!violationOnly) e.currentTarget.style.background = T.panel;
  }, [violationOnly, T.panel]);

  const nodeLayerMap = useMemo(
    () => archMode ? buildNodeLayerMap(graphData.nodes, archConfig || undefined) : null,
    [archMode, graphData.nodes, archConfig]
  );
  const layerOrder = useMemo(
    () => archConfig?.layers?.slice().sort((a, b) => a.order - b.order).map(l => l.id),
    [archConfig]
  );
  const allViolations = useMemo(
    () => archMode ? detectArchViolations(graphData.edges, nodeLayerMap!, layerOrder) : new Map(),
    [archMode, graphData.edges, nodeLayerMap, layerOrder]
  );
  const filteredViolations = useMemo(
    () => new Map(
      Array.from(allViolations.entries()).filter(([, violation]) =>
        violationTypeFilters[violation.type] && violation.confidence >= minConfidence
      )
    ),
    [allViolations, violationTypeFilters, minConfidence]
  );
  const violationCount = filteredViolations.size;
  const violationsBySeverity = useMemo(() => ({
    error: Array.from(filteredViolations.values()).filter(v => v.severity === 'error').length,
    warning: Array.from(filteredViolations.values()).filter(v => v.severity === 'warning').length,
    info: Array.from(filteredViolations.values()).filter(v => v.severity === 'info').length,
  }), [filteredViolations]);

  return (
    <div style={{ flex: 1, position: 'relative', background: T.bg, overflow: 'hidden' }}>
      {/* Empty state */}
      {graphData.nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          pointerEvents: 'none', zIndex: 1,
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, border: `2px dashed ${T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 28, opacity: 0.3 }}>⬡</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.textMuted }}>No files analyzed</div>
          <div style={{ fontSize: 13, color: T.textFaint }}>Scan your workspace to build the dependency map</div>
        </div>
      )}

      <div ref={refs.containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Arch View toggle button — top left */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        display: 'flex', gap: 8, zIndex: 10,
      }}>
        <button
          onClick={handleToggleArchMode}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 500,
            background: archMode ? T.accent : T.panel, border: `1px solid ${archMode ? T.accent : T.border}`,
            borderRadius: 6, color: archMode ? 'white' : T.textMuted, cursor: 'pointer',
            backdropFilter: 'blur(8px)', transition: 'all 0.2s ease',
          }}
          onMouseEnter={handleArchBtnMouseEnter}
          onMouseLeave={handleArchBtnMouseLeave}
        >
          Arch {archMode ? '✓' : ''}
        </button>
        {archMode && (
          <button
            onClick={handleToggleViolationOnly}
            title={violationOnly ? 'Show all connections' : 'Show only illegal back-references'}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 500,
              background: violationOnly ? T.red : T.panel,
              border: `1px solid ${violationOnly ? T.red : T.border}`,
              borderRadius: 6, color: violationOnly ? 'white' : T.textMuted, cursor: 'pointer',
              backdropFilter: 'blur(8px)', transition: 'all 0.2s ease',
            }}
            onMouseEnter={handleViolationBtnMouseEnter}
            onMouseLeave={handleViolationBtnMouseLeave}
          >
            ⚠ Violations {violationOnly ? 'ON' : ''}
          </button>
        )}
        {violationCount > 0 && (
          <div style={{
            padding: '6px 8px', fontSize: 10, fontWeight: 600,
            background: T.red, color: 'white', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {violationCount} violation{violationCount > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Legend — context-aware */}
      <LegendPanel
        archMode={archMode}
        graphData={graphData}
        T={T}
        violationTypeFilters={violationTypeFilters}
        setViolationTypeFilters={setViolationTypeFilters}
        minConfidence={minConfidence}
        setMinConfidence={setMinConfidence}
        violationCount={violationCount}
        violationsBySeverity={violationsBySeverity}
        allViolations={allViolations}
        archConfig={archConfig}
        violationOnly={violationOnly}
        setViolationOnly={setViolationOnly}
      />


      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10,
      }}>
        <ZoomBtn label="+" onClick={handleZoomIn} T={T} />
        <ZoomBtn label="−" onClick={handleZoomOut} T={T} />
        <ZoomBtn label="⊡" onClick={handleFitView} T={T} />
      </div>

      {/* Interaction hint */}
      <div style={{
        position: 'absolute', bottom: 52, right: 16, fontSize: 10, color: T.textFaint,
        pointerEvents: 'none', textAlign: 'right', lineHeight: 1.8, zIndex: 10,
      }}>
        Hover to highlight · Click to inspect · Drag to rearrange
      </div>
    </div>
  );
}

interface LegendPanelProps {
  archMode: boolean;
  graphData: GraphData;
  T: ReturnType<typeof useTheme>['T'];
  violationTypeFilters?: Record<ViolationType, boolean>;
  setViolationTypeFilters?: (f: Record<ViolationType, boolean>) => void;
  minConfidence?: number;
  setMinConfidence?: (c: number) => void;
  violationCount?: number;
  violationsBySeverity?: Record<string, number>;
  allViolations?: Map<string, ArchViolation>;
  archConfig?: ArchMapping | null;
  violationOnly?: boolean;
  setViolationOnly?: (v: boolean) => void;
}

function LegendPanel({
  archMode,
  graphData,
  T,
  violationTypeFilters,
  setViolationTypeFilters,
  minConfidence,
  setMinConfidence,
  violationCount = 0,
  violationsBySeverity = { error: 0, warning: 0, info: 0 },
  allViolations = new Map(),
  archConfig,
  violationOnly,
  setViolationOnly,
}: LegendPanelProps) {
  const [showDetails, setShowDetails] = useState(false);

  const handleToggleDetails = useCallback(() => setShowDetails(prev => !prev), []);

  const handleViolationTypeChange = useCallback((type: ViolationType) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (setViolationTypeFilters) {
      setViolationTypeFilters({ ...violationTypeFilters!, [type]: e.target.checked });
    }
  }, [violationTypeFilters, setViolationTypeFilters]);

  const handleConfidenceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (setMinConfidence) setMinConfidence(parseInt(e.target.value) / 100);
  }, [setMinConfidence]);

  const handleViolationOnlyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (setViolationOnly) setViolationOnly(e.target.checked);
  }, [setViolationOnly]);

  const handleDetailsMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = T.elevated;
    e.currentTarget.style.color = T.textMuted;
  }, [T.elevated, T.textMuted]);

  const handleDetailsMouseLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.color = T.textDim;
  }, [T.textDim]);
  const hasTs = graphData.nodes.some(n => ['typescript', 'tsx', 'jsx'].includes(n.type));
  const hasCsharp = graphData.nodes.some(n => n.type === 'csharp');

  // Layers to render in legend — use arch.json layers if available, else fall back to Clean Architecture defaults
  const legendLayers = archConfig
    ? [...archConfig.layers].sort((a, b) => a.order - b.order).map(l => ({ label: l.label, color: l.color }))
    : [
        { label: 'Application', color: 'rgba(219,39,119,0.15)' },
        { label: 'Interface', color: 'rgba(234,179,8,0.15)' },
        { label: 'Use Case', color: 'rgba(59,130,246,0.15)' },
        { label: 'Domain', color: 'rgba(34,197,94,0.15)' },
        { label: 'Entity', color: 'rgba(16,185,129,0.15)' },
        { label: 'Data', color: 'rgba(245,158,11,0.15)' },
        { label: 'Infrastructure', color: 'rgba(239,68,68,0.15)' },
      ];

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16,
      background: T.panel, backdropFilter: 'blur(8px)',
      border: `1px solid ${T.border}`, borderRadius: 8,
      zIndex: 10,
      maxWidth: 480,
    }}>
      {archMode ? (
        <div style={{ padding: '8px 14px', fontSize: 11, color: T.textMuted }}>
          {/* Arch layers legend — driven by arch.json */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: showDetails ? 8 : 0, flexWrap: 'wrap' }}>
            {legendLayers.map(layer => (
              <span key={layer.label}>
                <span style={{
                  display: 'inline-block', width: 12, height: 12,
                  background: layer.color.replace(/[\d.]+\)$/, '0.25)'),
                  border: `1px solid ${T.border}`, borderRadius: 2,
                }} />
                {' '}{layer.label.replace(/ Layer$/, '')}
              </span>
            ))}
          </div>

          {/* Violation severity colors */}
          {violationCount > 0 && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 10, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
              {violationsBySeverity.error > 0 && <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#ef4444', borderRadius: 2 }} /> Error: {violationsBySeverity.error}</span>}
              {violationsBySeverity.warning > 0 && <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#f97316', borderRadius: 2 }} /> Warning: {violationsBySeverity.warning}</span>}
              {violationsBySeverity.info > 0 && <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#eab308', borderRadius: 2 }} /> Info: {violationsBySeverity.info}</span>}
            </div>
          )}

          {/* Violation-only toggle */}
          {violationCount > 0 && setViolationOnly && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', fontSize: 10 }}>
                <input
                  type="checkbox"
                  checked={violationOnly}
                  onChange={handleViolationOnlyChange}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ color: T.textMuted, fontWeight: 500 }}>
                  ⚠ Show only illegal back-references
                </span>
              </label>
              <div style={{ fontSize: 9, color: T.textFaint, marginTop: 2, marginLeft: 22 }}>
                Dims all legal connections; highlights only wrong-direction imports
              </div>
            </div>
          )}

          {/* Violation type toggles */}
          {violationTypeFilters && setViolationTypeFilters && (
            <div style={{ marginTop: 8, fontSize: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>Show violations:</div>
              {(['reverse-dependency', 'external-from-core', 'cross-layer-cycle'] as ViolationType[]).map(type => (
                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={violationTypeFilters[type]}
                    onChange={handleViolationTypeChange(type)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>{type === 'reverse-dependency' ? 'Reverse Dependency' : type === 'external-from-core' ? 'External from Core' : 'Cross-Layer Cycles'}</span>
                </label>
              ))}
            </div>
          )}

          {/* Confidence slider */}
          {minConfidence !== undefined && setMinConfidence && (
            <div style={{ marginTop: 8, fontSize: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 600, color: T.textMuted }}>Confidence threshold: {Math.round(minConfidence * 100)}%</div>
              <input
                type="range"
                min="0"
                max="100"
                step="10"
                value={Math.round(minConfidence * 100)}
                onChange={handleConfidenceChange}
                style={{ cursor: 'pointer', width: '100%' }}
              />
              <div style={{ fontSize: 9, color: T.textFaint }}>Only show violations with higher confidence</div>
            </div>
          )}

          {showDetails && (
            <div style={{ fontSize: 10, color: T.textFaint, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
              <div style={{ marginBottom: 8, fontWeight: 600, color: T.textMuted }}>Architectural Violations — Scoring & Examples:</div>

              <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Reverse Dependency (High confidence)</div>
                <div style={{ marginBottom: 2 }}><span style={{ color: T.red, fontWeight: 600 }}>service.ts → api.ts</span> (service → api violation)</div>
                <div style={{ marginBottom: 2, color: T.textFaint }}>90% confidence: Strong violation of dependency flow</div>
                <div style={{ marginBottom: 4, color: T.textFaint }}>Why bad: Inner layers shouldn't import from outer layers</div>
                <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: Use dependency injection or interfaces</div>
              </div>

              <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>⚠ Type Import (Low confidence)</div>
                <div style={{ marginBottom: 2 }}><span style={{ color: T.orange, fontWeight: 600 }}>service.ts → types.ts</span> (importing types is OK)</div>
                <div style={{ marginBottom: 2, color: T.textFaint }}>30% confidence: Likely false positive for type-only imports</div>
                <div style={{ marginBottom: 4, color: T.textFaint }}>Suppressed: Type imports don't create true runtime coupling</div>
                <div style={{ color: T.green, fontWeight: 500 }}>✓ Use: {'import type { T } from \'...\''}</div>
              </div>

              <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>⚠ Safe External Lib (Ignored)</div>
                <div style={{ marginBottom: 2 }}><span style={{ color: T.orange, fontWeight: 600 }}>domain.ts → date-fns</span> (safe utility library)</div>
                <div style={{ marginBottom: 2, color: T.textFaint }}>Not flagged: Utility libs (lodash, zod, date-fns) are allowed</div>
                <div style={{ marginBottom: 4, color: T.textFaint }}>Common safe libs: date-fns, zod, uuid, lodash, chalk</div>
              </div>

              <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ External Dependency from Core</div>
                <div style={{ marginBottom: 2 }}><span style={{ color: T.red, fontWeight: 600 }}>domain.ts → custom-vendor-lib</span> (framework coupling)</div>
                <div style={{ marginBottom: 2, color: T.textFaint }}>80% confidence: Core shouldn't depend on non-standard libs</div>
                <div style={{ marginBottom: 4, color: T.textFaint }}>Why bad: Couples business logic to specific vendors</div>
                <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: infrastructure.ts → vendor-lib → domain.ts (adapter pattern)</div>
              </div>

              <div>
                <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Cross-Layer Cycles (Highest severity)</div>
                <div style={{ marginBottom: 2 }}><span style={{ color: T.red, fontWeight: 600 }}>service.ts ↔ repository.ts</span> (circular across layers)</div>
                <div style={{ marginBottom: 2, color: T.textFaint }}>95% confidence: Real architectural problem, high severity</div>
                <div style={{ color: T.textFaint }}>Why bad: Makes testing impossible, hides true dependencies</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '8px 14px', fontSize: 11, color: T.textMuted }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: showDetails ? 8 : 0 }}>
            <span><span style={{ color: T.green, fontWeight: 700 }}>━</span> Healthy ≥8</span>
            <span><span style={{ color: T.yellow, fontWeight: 700 }}>━</span> Warning ≥6</span>
            <span><span style={{ color: T.orange, fontWeight: 700 }}>━</span> Degraded ≥4</span>
            <span><span style={{ color: T.red, fontWeight: 700 }}>━</span> Critical &lt;4</span>
          </div>
          {showDetails && (
            <div style={{ fontSize: 10, color: T.textFaint, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
              {hasTs && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>React/TypeScript — Code Patterns:</div>
                  <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Too Many Hooks</div>
                    <div style={{ marginBottom: 2, color: T.textFaint }}>5+ hook calls in one component (useState, useEffect, etc.)</div>
                    <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: ≤ 3–5 hooks, extract rest to custom hooks</div>
                  </div>
                  <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Missing Key Props</div>
                    <div style={{ marginBottom: 2, color: T.textFaint }}>{`items.map(item => <div>{item.name}</div>)`} — no key</div>
                    <div style={{ color: T.green, fontWeight: 500 }}>{`✓ Correct: <div key={item.id}>`}</div>
                  </div>
                  <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Inline Event Handlers</div>
                    <div style={{ marginBottom: 2, color: T.textFaint }}>{`<button onClick={() => setState(x + 1)}>`} creates new function on every render</div>
                    <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: useCallback or named function</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Any Type</div>
                    <div style={{ color: T.textFaint }}>Unsafe: bypasses TypeScript safety</div>
                    <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: explicit types or `unknown`</div>
                  </div>
                </div>
              )}
              {hasCsharp && (
                <div>
                  <div style={{ fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>C#/.NET — Code Patterns:</div>
                  <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ God Class</div>
                    <div style={{ marginBottom: 2, color: T.textFaint }}>Classes with 20+ methods doing many unrelated tasks</div>
                    <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: ≤ 20 methods, each with single responsibility</div>
                  </div>
                  <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Long Methods</div>
                    <div style={{ marginBottom: 2, color: T.textFaint }}>{'Methods >50 lines hard to test and reason about'}</div>
                    <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: Extract logic into smaller, focused methods</div>
                  </div>
                  <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Tight Coupling</div>
                    <div style={{ marginBottom: 2, color: T.textFaint }}>Constructor with 5+ parameters (OrderService, PaymentService, LogService...)</div>
                    <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: Use config object or DI container</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, color: T.accent, marginBottom: 2 }}>❌ Empty Catch Blocks</div>
                    <div style={{ marginBottom: 2, color: T.textFaint }}>Silently swallows exceptions, hides bugs</div>
                    <div style={{ color: T.green, fontWeight: 500 }}>✓ Correct: Log, handle, or re-throw with context</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <button
        onClick={handleToggleDetails}
        style={{
          width: '100%', padding: '6px 0', background: 'transparent',
          border: `1px solid ${T.border}`, borderTop: showDetails ? 'none' : undefined,
          borderRadius: showDetails ? '0 0 8px 8px' : 0,
          color: T.textDim, fontSize: 10, cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseEnter={handleDetailsMouseEnter}
        onMouseLeave={handleDetailsMouseLeave}
      >
        {showDetails ? '▲ Hide patterns' : '▼ Show ideal patterns'}
      </button>
    </div>
  );
}

function ZoomBtn({ label, onClick, T }: { label: string; onClick: () => void; T: ReturnType<typeof useTheme>['T'] }) {
  function handleMouseEnter(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.background = T.cardBgHover;
    e.currentTarget.style.borderColor = T.borderBright;
  }
  function handleMouseLeave(e: React.MouseEvent<HTMLButtonElement>) {
    e.currentTarget.style.background = T.panelHover;
    e.currentTarget.style.borderColor = T.border;
  }
  return (
    <button
      onClick={onClick}
      style={{
        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: 6, color: T.textMuted, cursor: 'pointer', fontSize: 16,
        backdropFilter: 'blur(8px)',
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {label}
    </button>
  );
}
