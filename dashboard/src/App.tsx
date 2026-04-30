import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GraphView } from './components/GraphView';
import { Sidebar } from './components/Sidebar';
import { GraphData, GraphNode, RepoInfo, WSMessage } from './types';

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

  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [showRepoSelector, setShowRepoSelector] = useState(false);

  const scanningRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyzedRef = useRef(0);

  const setScanningState = (v: boolean) => {
    scanningRef.current = v;
    setScanning(v);
  };

  const connect = useCallback((repo: string | null) => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    const url = repo
      ? `ws://${window.location.host}?repo=${encodeURIComponent(repo)}`
      : `ws://${window.location.host}`;

    const ws = new WebSocket(url);
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
      reconnectTimer.current = setTimeout(() => connect(repo), 3000);
    };
    ws.onerror = () => ws.close();
  }, []);

  // Fetch repos then decide: auto-select single or show picker
  useEffect(() => {
    fetch('/api/repos')
      .then(r => r.json())
      .then((data: RepoInfo[]) => {
        setRepos(data);
        if (data.length === 1) {
          setSelectedRepo(data[0].repoRoot);
          connect(data[0].repoRoot);
        } else if (data.length > 1) {
          setShowRepoSelector(true);
          connect(null); // show merged view while picking
        } else {
          connect(null); // no repos yet — real-time only
        }
      })
      .catch(() => connect(null));

    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const handleRepoSelect = (repo: string) => {
    setSelectedRepo(repo);
    setShowRepoSelector(false);
    setGraphData({ nodes: [], edges: [] });
    connect(repo);
  };

  const handleScanAll = async () => {
    if (scanningRef.current) return;
    setScanningState(true);
    setScanProgress({ analyzed: 0, total: 0 });
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      if (!res.ok) {
        setScanningState(false);
        setScanProgress(null);
      }
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
  const currentRepoLabel = selectedRepo
    ? (repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop())
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", monospace' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <header style={{
        height: 52, minHeight: 52,
        background: '#0f172a', borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 24,
        zIndex: 20, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18, color: '#3b82f6', letterSpacing: -0.5 }}>⬡</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', letterSpacing: -0.3 }}>Gate Keeper</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b', marginLeft: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot, display: 'inline-block' }} />
            {wsStatus}
          </span>
        </div>

        <div style={{ width: 1, height: 24, background: '#1e293b' }} />

        {/* Repo selector button */}
        <button
          onClick={() => setShowRepoSelector(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#1e293b', border: '1px solid #334155',
            borderRadius: 6, color: currentRepoLabel ? '#94a3b8' : '#475569',
            cursor: 'pointer', fontSize: 12, padding: '4px 10px',
            maxWidth: 220, overflow: 'hidden'
          }}
        >
          <span style={{ color: '#3b82f6' }}>◈</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentRepoLabel ?? 'All repos'}
          </span>
          {repos.length > 1 && <span style={{ color: '#475569', marginLeft: 2 }}>▾</span>}
        </button>

        <div style={{ width: 1, height: 24, background: '#1e293b' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <StatPill label="Files" value={graphData.nodes.length} color="#94a3b8" />
          {overallRating !== null && (
            <StatPill label="Arch Score" value={`${overallRating.toFixed(1)}/10`} color={ratingColor(overallRating)} bold />
          )}
          <StatPill label="Violations" value={totalViolations} color={totalViolations > 0 ? '#ef4444' : '#22c55e'} />
          {errorCount > 0 && <StatPill label="Errors" value={errorCount} color="#ef4444" bold />}
        </div>

        <div style={{ flex: 1 }} />

        {lastScan && !scanning && (
          <span style={{ fontSize: 12, color: '#475569' }}>Last scan: {lastScan.fileCount} files</span>
        )}
        {scanning && scanProgress && (
          <span style={{ fontSize: 12, color: '#eab308' }}>
            Scanning {scanProgress.analyzed}/{scanProgress.total > 0 ? scanProgress.total : '…'} files
          </span>
        )}

        <button
          onClick={handleScanAll}
          disabled={scanning || wsStatus !== 'connected'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: scanning ? '#1e293b' : '#1d4ed8',
            border: `1px solid ${scanning ? '#334155' : '#2563eb'}`,
            borderRadius: 6, color: scanning ? '#475569' : '#eff6ff',
            cursor: scanning ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 600, padding: '6px 14px',
            letterSpacing: 0.2, transition: 'all 0.15s'
          }}
        >
          <span style={{ display: 'inline-block', animation: scanning ? 'spin 1s linear infinite' : 'none' }}>⟳</span>
          {scanning ? 'Scanning…' : 'Scan All Files'}
        </button>
      </header>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Main area ──────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <GraphView
          graphData={graphData}
          onNodeClick={setSelectedNode}
          highlightNodeId={selectedNode?.id}
          selectedRepo={selectedRepo}
        />
        <Sidebar
          graphData={graphData}
          selectedNode={selectedNode}
          onClearSelection={() => setSelectedNode(null)}
          onNodeSelect={setSelectedNode}
        />
      </div>

      {/* ── Repo selector modal ─────────────────────────────── */}
      {showRepoSelector && (
        <RepoSelectorModal
          repos={repos}
          selectedRepo={selectedRepo}
          onSelect={handleRepoSelect}
          onClose={() => setShowRepoSelector(false)}
        />
      )}
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
      <span style={{ fontSize: 16, fontWeight: bold ? 700 : 600, color }}>{value}</span>
    </div>
  );
}

function RepoSelectorModal({ repos, selectedRepo, onSelect, onClose }: {
  repos: RepoInfo[];
  selectedRepo: string | null;
  onSelect: (repo: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f172a', border: '1px solid #1e293b',
          borderRadius: 12, padding: 24, minWidth: 360, maxWidth: 520,
          boxShadow: '0 25px 60px rgba(0,0,0,0.6)'
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>
          Select Repository
        </div>
        <div style={{ fontSize: 12, color: '#475569', marginBottom: 20 }}>
          Multiple repos found in the database. Pick one to view.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {repos.map(r => (
            <button
              key={r.repoRoot}
              onClick={() => onSelect(r.repoRoot)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: selectedRepo === r.repoRoot ? '#1e3a5f' : '#0d1526',
                border: `1px solid ${selectedRepo === r.repoRoot ? '#3b82f6' : '#1e293b'}`,
                borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                color: '#f1f5f9', textAlign: 'left', transition: 'all 0.12s'
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>
                  {r.label}
                </div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                  {r.repoRoot}
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginLeft: 16, whiteSpace: 'nowrap' }}>
                {r.fileCount} file{r.fileCount !== 1 ? 's' : ''}
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '8px 0',
            background: 'transparent', border: '1px solid #1e293b',
            borderRadius: 6, color: '#475569', cursor: 'pointer', fontSize: 12
          }}
        >
          Cancel (show all)
        </button>
      </div>
    </div>
  );
}
