import React, { useEffect, useRef, useState } from 'react';
import { GraphView } from './components/GraphView';
import { Sidebar } from './components/Sidebar';
import { GraphData, GraphNode, WSMessage } from './types';

const WS_URL = `ws://${window.location.host}`;

function mergeGraphData(prev: GraphData, delta: { nodes: GraphNode[]; edges: any[] }): GraphData {
  const nodeMap = new Map(prev.nodes.map(n => [n.id, n]));
  for (const n of delta.nodes) nodeMap.set(n.id, n);

  const edgeKey = (e: any) => {
    const s = typeof e.source === 'string' ? e.source : e.source?.id;
    const t = typeof e.target === 'string' ? e.target : e.target?.id;
    return `${s}→${t}`;
  };

  const edgeMap = new Map(prev.edges.map(e => [edgeKey(e), e]));
  for (const e of delta.edges) edgeMap.set(edgeKey(e), e);

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values())
  };
}

export default function App() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [lastFile, setLastFile] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');

    ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        if (msg.type === 'init' && msg.data) {
          setGraphData(msg.data);
        } else if (msg.type === 'update' && msg.delta) {
          setGraphData(prev => mergeGraphData(prev, msg.delta!));
          if (msg.analysis) setLastFile(msg.analysis.path.split('/').pop() ?? '');
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  };

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  const statusDot = {
    connecting: '#ffc107',
    connected: '#4caf50',
    disconnected: '#f44336'
  }[wsStatus];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <GraphView
        graphData={graphData}
        onNodeClick={setSelectedNode}
        highlightNodeId={selectedNode?.id}
      />
      <Sidebar
        graphData={graphData}
        selectedNode={selectedNode}
        onClearSelection={() => setSelectedNode(null)}
      />

      {/* Status bar */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 300,
          padding: '6px 16px',
          background: 'rgba(10,10,30,0.85)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
          color: '#9e9e9e',
          backdropFilter: 'blur(4px)',
          zIndex: 10
        }}
      >
        <span style={{ color: '#e040fb', fontWeight: 700, fontSize: 14 }}>⬡ Gate Keeper</span>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusDot, marginRight: 4 }} />
          {wsStatus}
        </span>
        {lastFile && <span>Last: <strong style={{ color: '#ccc' }}>{lastFile}</strong></span>}
        <span style={{ marginLeft: 'auto' }}>
          {graphData.nodes.length} files · Arch: {
            graphData.nodes.length > 0
              ? (graphData.nodes.reduce((a, n) => a + n.rating, 0) / graphData.nodes.length).toFixed(1)
              : '—'
          }/10
        </span>
      </div>
    </div>
  );
}
