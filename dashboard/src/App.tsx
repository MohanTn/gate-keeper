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
  return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
}

function ratingColor(r: number) {
  if (r >= 8) return '#22c55e';
  if (r >= 6) return '#eab308';
  if (r >= 4) return '#f97316';
  return '#ef4444';
}

export default function App() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ analyzed: number; total: number } | null>(null);
  const [lastScan, setLastScan] = useState<{ fileCount: number; ts: number } | null>(null);

  // Refs to avoid stale closures inside the WS handler
  const scanningRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzedRef = useRef(0);

  const setScanningState = (v: boolean) => {
    scanningRef.current = v;
    setScanning(v);
  };

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
          if (scanningRef.current) {
            analyzedRef.current += 1;
            setScanProgress({ analyzed: analyzedRef.current, total: msg.scanTotal ?? 0 });
          }
        } else if (msg.type === 'scan_start') {
          setScanningState(true);
          analyzedRef.current = 0;
          setScanProgress({ analyzed: 0, total: msg.scanTotal ?? 0 });
        } else if (msg.type === 'scan_complete') {
          setScanningState(false);
          setLastScan({ fileCount: msg.scanAnalyzed ?? 0, ts: Date.now() });
          setScanProgress(null);
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

  const handleScanAll = async () => {
    if (scanningRef.current) return;
    setScanningState(true);
    setScanProgress({ analyzed: 0, total: 0 });
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      if (!res.ok) {
        // Server might return 409 if already scanning
        setScanningState(false);
        setScanProgress(null);
      }
      // scan_start WS message will confirm and update total count
    } catch {
      setScanningState(false);
      setScanProgress(null);
    }
  };

  const totalViolations = graphData.nodes.reduce((a, n) => a + n.violations.length, 0);
  const errorCount = graphData.nodes.reduce(
    (a, n) => a + n.violations.filter(v => v.severity === 'error').length, 0
  );
  const overallRating = graphData.nodes.length > 0
    ? (graphData.nodes.reduce((a, n) => a + n.rating, 0) / graphData.nodes.length)
    : null;

  const statusDot = { connecting: '#eab308', connected: '#22c55e', disconnected: '#ef4444' }[wsStatus];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", monospace' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <header style={{
        height: 52,
        minHeight: 52,
        background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 24,
        zIndex: 20,
        flexShrink: 0
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18, color: '#3b82f6', letterSpacing: -0.5 }}>⬡</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', letterSpacing: -0.3 }}>Gate Keeper</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b', marginLeft: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot, display: 'inline-block' }} />
            {wsStatus}
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: '#1e293b' }} />

        {/* Metrics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <StatPill label="Files" value={graphData.nodes.length} color="#94a3b8" />
          {overallRating !== null && (
            <StatPill
              label="Arch Score"
              value={`${overallRating.toFixed(1)}/10`}
              color={ratingColor(overallRating)}
              bold
            />
          )}
          <StatPill
            label="Violations"
            value={totalViolations}
            color={totalViolations > 0 ? '#ef4444' : '#22c55e'}
          />
          {errorCount > 0 && (
            <StatPill label="Errors" value={errorCount} color="#ef4444" bold />
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Last scan result */}
        {lastScan && !scanning && (
          <span style={{ fontSize: 12, color: '#475569' }}>
            Last scan: {lastScan.fileCount} files
          </span>
        )}
        {scanning && scanProgress && (
          <span style={{ fontSize: 12, color: '#eab308' }}>
            Scanning {scanProgress.analyzed}/{scanProgress.total > 0 ? scanProgress.total : '…'} files
          </span>
        )}

        {/* Scan button */}
        <button
          onClick={handleScanAll}
          disabled={scanning || wsStatus !== 'connected'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: scanning ? '#1e293b' : '#1d4ed8',
            border: `1px solid ${scanning ? '#334155' : '#2563eb'}`,
            borderRadius: 6,
            color: scanning ? '#475569' : '#eff6ff',
            cursor: scanning ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
            padding: '6px 14px',
            letterSpacing: 0.2,
            transition: 'all 0.15s'
          }}
        >
          <span style={{
            display: 'inline-block',
            animation: scanning ? 'spin 1s linear infinite' : 'none'
          }}>⟳</span>
          {scanning ? 'Scanning…' : 'Scan All Files'}
        </button>
      </header>

      {/* Spin keyframes injected once */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Main area ──────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <GraphView
          graphData={graphData}
          onNodeClick={setSelectedNode}
          highlightNodeId={selectedNode?.id}
        />
        <Sidebar
          graphData={graphData}
          selectedNode={selectedNode}
          onClearSelection={() => setSelectedNode(null)}
          onNodeSelect={setSelectedNode}
        />
      </div>
    </div>
  );
}

function StatPill({ label, value, color, bold }: {
  label: string; value: number | string; color: string; bold?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1 }}>
      <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>
        {label}
      </span>
      <span style={{ fontSize: 16, fontWeight: bold ? 700 : 600, color }}>
        {value}
      </span>
    </div>
  );
}
