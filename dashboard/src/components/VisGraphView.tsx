import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Network } from 'vis-network/standalone';
import { DataSet } from 'vis-data/standalone';
import { GraphData, GraphNode } from '../types';
import { useTheme } from '../ThemeContext';
import {
  healthColor,
  makeNodeColor,
  buildVisNodes,
  buildVisEdges,
  computeHierarchicalPositions,
} from './graph-utils';

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
  from?: string;
  to?: string;
  color?: { color: string; highlight: string };
  width?: number;
  _isCircular?: boolean;
}

interface NetworkRefs {
  containerRef: React.RefObject<HTMLDivElement>;
  networkRef: React.RefObject<Network | undefined>;
  nodesDS: React.RefObject<DataSet<VisNodeData>>;
  edgesDS: React.RefObject<DataSet<VisEdgeData>>;
  pinnedRef: React.RefObject<Map<string, { x: number; y: number }>>;
  treePositionsRef: React.RefObject<Map<string, { x: number; y: number }>>;
}

// ── Shared refs ────────────────────────────────────────────
function useNetworkRefs(): NetworkRefs {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | undefined>(undefined);
  const nodesDS = useRef<DataSet<VisNodeData>>(new DataSet<VisNodeData>());
  const edgesDS = useRef<DataSet<VisEdgeData>>(new DataSet<VisEdgeData>());
  const pinnedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const treePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  return { containerRef, networkRef, nodesDS, edgesDS, pinnedRef, treePositionsRef };
}

// ── Position persistence ───────────────────────────────────
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

// ── Sync graph data, node selection, scanning interaction ──
function useSyncGraphData(
  refs: NetworkRefs,
  graphData: GraphData,
  T: ReturnType<typeof useTheme>['T'],
  focusNodeId?: string | null,
  highlightNodeId?: string,
  scanning?: boolean,
) {
  const LARGE_GRAPH_THRESHOLD = 200;

  useEffect(() => {
    const isLarge = graphData.nodes.length > LARGE_GRAPH_THRESHOLD;
    const positions = isLarge
      ? new Map<string, { x: number; y: number }>()
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
  }, [graphData.nodes, graphData.edges, T, refs]);

  useEffect(() => {
    refs.edgesDS.current.clear();
    const visEdges = buildVisEdges(graphData, T);
    refs.edgesDS.current.add(visEdges);
  }, [graphData.edges, T, graphData.nodes]);

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
          color: makeNodeColor(healthColor(gn.rating, T), T),
          borderWidth: 2,
        });
      }
    };
  }, [highlightNodeId, graphData.nodes, T, refs]);

  useEffect(() => {
    if (!refs.networkRef.current) return;
    refs.networkRef.current.setOptions({
      interaction: { dragView: !scanning }
    });
  }, [refs, scanning]);
}

// ── Initialize network ─────────────────────────────────────
function useInitializeNetwork(refs: NetworkRefs, graphData: GraphData, params: VisGraphViewProps, T: ReturnType<typeof useTheme>['T']) {
  const graphDataRef = useRef(graphData);
  const onNodeClickRef = useRef(params.onNodeClick);
  const onCanvasClickRef = useRef(params.onCanvasClick);
  const selectedRepoRef = useRef(params.selectedRepo);

  useEffect(() => {
    graphDataRef.current = graphData;
    onNodeClickRef.current = params.onNodeClick;
    onCanvasClickRef.current = params.onCanvasClick;
    selectedRepoRef.current = params.selectedRepo;
  }, [graphData, params.onNodeClick, params.onCanvasClick, params.selectedRepo]);

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

    const nodeById = () => new Map(graphDataRef.current.nodes.map(n => [n.id, n]));
    let lastHoverUpdatedIds: string[] = [];
    let lastHoverEdgeIds: string[] = [];

    network.on('hoverNode', (hoverParams: { node: string }) => {
      const nodeId = hoverParams.node;
      const isLargeGraph = graphDataRef.current.nodes.length > 200;
      const connectedNodeIds = network.getConnectedNodes(nodeId) as string[];
      const connectedEdgeIds = network.getConnectedEdges(nodeId) as string[];
      const nodeMap = nodeById();

      if (isLargeGraph) {
        handleLargeGraphHover(nodeId, connectedNodeIds, connectedEdgeIds, nodeMap);
      } else {
        handleSmallGraphHover(nodeId, connectedNodeIds, connectedEdgeIds, nodeMap);
      }
    });

    network.on('blurNode', restoreStyles);
    network.on('click', handleNetworkClick);
    network.on('dragEnd', handleNodeDragEnd);

    const fitTimer = setTimeout(() => {
      try {
        refs.networkRef.current?.fit({
          animation: { duration: 500, easingFunction: 'easeInOutQuad' },
          maxZoomLevel: 1.2,
          minZoomLevel: 0.15,
        });
      } catch { /* fit may fail on empty graph */ }
    }, 200);

    function handleLargeGraphHover(nodeId: string, connectedNodeIds: string[], connectedEdgeIds: string[], nodeMap: Map<string, GraphNode>) {
      const touchedIds = [nodeId, ...connectedNodeIds];
      const nodeUpdates = touchedIds.map(id => {
        const gn = nodeMap.get(id);
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
        const e = refs.edgesDS.current.get(id) as unknown as VisEdgeData;
        const isCirc = e?._isCircular;
        return {
          id,
          color: { color: isCirc ? T.edgeCircular : T.edgeHighlight, highlight: T.edgeHighlight },
          width: 2.5,
        };
      });
      refs.edgesDS.current.update(edgeUpdates);

      lastHoverUpdatedIds = touchedIds;
      lastHoverEdgeIds = connectedEdgeIds;
    }

    function handleSmallGraphHover(nodeId: string, connectedNodeIds: string[], connectedEdgeIds: string[], nodeMap: Map<string, GraphNode>) {
      const connectedSet = new Set(connectedNodeIds);
      connectedSet.add(nodeId);
      const connectedEdgeSet = new Set(connectedEdgeIds);

      const allNodeIds = refs.nodesDS.current.getIds() as string[];
      const nodeUpdates = allNodeIds.map(id => {
        const gn = nodeMap.get(id);
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
          const e = refs.edgesDS.current.get(id) as unknown as VisEdgeData;
          const isCirc = e?._isCircular;
          return {
            id,
            color: { color: isCirc ? T.edgeCircular : T.edgeHighlight, highlight: T.edgeHighlight },
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
      const nodeMap = nodeById();

      if (isLargeGraph && lastHoverUpdatedIds.length > 0) {
        const nodeUpdates = lastHoverUpdatedIds.map(id => {
          const gn = nodeMap.get(id);
          const color = healthColor(gn?.rating ?? 5, T);
          return { id, color: makeNodeColor(color, T), borderWidth: 2 };
        });
        refs.nodesDS.current.update(nodeUpdates);

        const edgeUpdates = lastHoverEdgeIds.map(id => {
          const e = refs.edgesDS.current.get(id) as unknown as VisEdgeData;
          const isCirc = e?._isCircular;
          return {
            id,
            color: {
              color: isCirc ? T.edgeCircular : T.edgeDefault,
              highlight: isCirc ? T.edgeCircular : T.edgeHighlight,
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
          const gn = nodeMap.get(id);
          const color = healthColor(gn?.rating ?? 5, T);
          return {
            id,
            color: makeNodeColor(color, T),
            font: { color: T.text, size: 14, face: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' },
            borderWidth: 2,
          };
        });
        refs.nodesDS.current.update(nodeUpdates);

        refs.edgesDS.current.clear();
        const rebuiltEdges = buildVisEdges(graphDataRef.current, T);
        refs.edgesDS.current.add(rebuiltEdges);
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
        const node = refs.nodesDS.current.get(nodeId) as unknown as VisNodeData | undefined;
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
    }

    return () => {
      clearTimeout(fitTimer);
      network.destroy();
      (refs.networkRef as React.MutableRefObject<Network | undefined>).current = undefined;
    };
  }, [T]);
}

// ── Zoom handlers ──────────────────────────────────────────
function useZoomHandlers(networkRef: React.RefObject<Network | undefined>) {
  const handleZoomIn = useCallback(() => {
    const net = networkRef.current; if (!net) return;
    const s = net.getScale(); const p = net.getViewPosition();
    net.moveTo({ position: p, scale: s * 1.3, animation: { duration: 200, easingFunction: 'easeInOutQuad' } });
  }, [networkRef]);
  const handleZoomOut = useCallback(() => {
    const net = networkRef.current; if (!net) return;
    const s = net.getScale(); const p = net.getViewPosition();
    net.moveTo({ position: p, scale: s * 0.77, animation: { duration: 200, easingFunction: 'easeInOutQuad' } });
  }, [networkRef]);
  const handleFitView = useCallback(() => {
    networkRef.current?.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' }, maxZoomLevel: 1 });
  }, [networkRef]);
  return { handleZoomIn, handleZoomOut, handleFitView };
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
}: VisGraphViewProps) {
  const { T } = useTheme();
  const refs = useNetworkRefs();

  usePositionPersistence(refs, selectedRepo);
  useSyncGraphData(refs, graphData, T, focusNodeId, highlightNodeId, scanning);
  useInitializeNetwork(refs, graphData, { graphData, onNodeClick, onCanvasClick, highlightNodeId, selectedRepo, focusNodeId, fitTrigger, scanning }, T);

  const { handleZoomIn, handleZoomOut, handleFitView } = useZoomHandlers(refs.networkRef);

  return (
    <div style={{ flex: 1, position: 'relative', background: T.bg, overflow: 'hidden' }}>
      {/* Empty state */}
      {graphData.nodes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
          pointerEvents: 'none', zIndex: 1,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.textMuted }}>No files analyzed</div>
          <div style={{ fontSize: 12, color: T.textFaint }}>Scan your workspace to build the dependency map.</div>
        </div>
      )}

      <div ref={refs.containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Rating color legend */}
      <div style={{
        position: 'absolute', bottom: 16, left: 16,
        background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
        padding: '8px 14px', zIndex: 10,
      }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: T.textMuted }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: T.green, borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />Healthy ≥8</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: T.yellow, borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />Warning ≥6</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: T.orange, borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />Degraded ≥4</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: T.red, borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />Critical &lt;4</span>
        </div>
        <div style={{ fontSize: 10, color: T.textFaint, marginTop: 6, borderTop: `1px solid ${T.border}`, paddingTop: 6 }}>
          Drag to pan, scroll to zoom
        </div>
      </div>

      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10,
      }}>
        <ZoomBtn label="+" onClick={handleZoomIn} T={T} />
        <ZoomBtn label="−" onClick={handleZoomOut} T={T} />
        <ZoomBtn label="Fit" onClick={handleFitView} T={T} />
      </div>
    </div>
  );
}

function ZoomBtn({ label, onClick, T }: { label: string; onClick: () => void; T: ReturnType<typeof useTheme>['T'] }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: T.panel, border: `1px solid ${T.border}`,
        borderRadius: 6, color: T.textMuted, cursor: 'pointer', fontSize: 16,
      }}
    >
      {label}
    </button>
  );
}
