import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GraphView } from './components/GraphView';
import { Sidebar } from './components/Sidebar';
import { GraphData, GraphNode, GraphEdge, RepoInfo, WSMessage } from './types';

const edgeKey = (e: GraphEdge): string => {
  const s = typeof e.source === 'string' ? e.source : e.source?.id;
  const t = typeof e.target === 'string' ? e.target : e.target?.id;
  return `${s}→${t}`;
};

function mergeGraphData(prev: GraphData, delta: { nodes: GraphNode[]; edges: GraphEdge[] }): GraphData {
  const nodeMap = new Map(prev.nodes.map(n => [n.id, n]));
  for (const n of delta.nodes) nodeMap.set(n.id, n);
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

// Custom hook: WebSocket connection & message handling
function useWebSocketConnection(selectedRepo: string | null, onRepoCreated?: () => void) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [scanProgress, setScanProgress] = useState<{ analyzed: number; total: number } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);
  const analyzedRef = useRef(0);
  const onRepoCreatedRef = useRef(onRepoCreated);
  onRepoCreatedRef.current = onRepoCreated;

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

    ws.onmessage = (event) => {
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
          scanningRef.current = true;
          analyzedRef.current = 0;
          setScanProgress({ analyzed: 0, total: msg.scanTotal ?? 0 });
        } else if (msg.type === 'scan_complete') {
          scanningRef.current = false;
          setScanProgress(null);
        } else if (msg.type === 'repo_created') {
          onRepoCreatedRef.current?.();
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      reconnectTimer.current = setTimeout(() => connect(repo), 3000);
    };
    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect(selectedRepo);
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [selectedRepo, connect]);

  return { graphData, wsStatus, scanProgress, scanningRef };
}

// Custom hook: Repo selection logic
function useRepoSelection() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [showRepoSelector, setShowRepoSelector] = useState(false);
  const initialLoadDone = useRef(false);

  const loadRepos = useCallback(() => {
    fetch('/api/repos')
      .then(r => r.json())
      .then((data: RepoInfo[]) => {
        setRepos(data);
        if (!initialLoadDone.current) {
          initialLoadDone.current = true;
          if (data.length === 1) {
            setSelectedRepo(data[0].repoRoot);
          } else if (data.length > 1) {
            setShowRepoSelector(true);
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  const handleRepoSelect = useCallback((repo: string) => {
    setSelectedRepo(repo);
    setShowRepoSelector(false);
  }, []);

  return {
    repos,
    selectedRepo,
    showRepoSelector,
    setShowRepoSelector,
    handleRepoSelect,
    refreshRepos: loadRepos,
  };
}

// Custom hook: Scan logic
function useScan(wsStatus: 'connecting' | 'connected' | 'disconnected', scanningRef: React.MutableRefObject<boolean>) {
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<{ fileCount: number; ts: number } | null>(null);

  const handleScanAll = useCallback(async () => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      if (!res.ok) {
        scanningRef.current = false;
        setScanning(false);
      }
    } catch {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [scanningRef]);

  return { scanning, setScanning, lastScan, setLastScan, handleScanAll };
}

// Custom hook: Node selection handlers
function useNodeHandlers() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const handlers = useCallback(
    (action: 'clear' | 'select', node?: GraphNode) => {
      if (action === 'clear') {
        setSelectedNode(null);
      } else if (action === 'select' && node) {
        setSelectedNode(node);
      }
    },
    []
  );

  return {
    selectedNode,
    handleClearSelection: () => handlers('clear'),
    handleNodeSelect: (node: GraphNode) => handlers('select', node),
  };
}

export default function App() {
  const {
    repos,
    selectedRepo,
    showRepoSelector,
    setShowRepoSelector,
    handleRepoSelect,
    refreshRepos,
  } = useRepoSelection();

  const { graphData, wsStatus, scanProgress, scanningRef } = useWebSocketConnection(selectedRepo, refreshRepos);
  const { scanning, setScanning, lastScan, setLastScan, handleScanAll } = useScan(wsStatus, scanningRef);
  const { selectedNode, handleClearSelection, handleNodeSelect } = useNodeHandlers();

  // Listeners for WebSocket scan events
  useEffect(() => {
    const handleScanComplete = () => {
      setScanning(false);
      setLastScan({ fileCount: graphData.nodes.length, ts: Date.now() });
    };
    // This is handled via WSMessage, triggered when scan_complete is received
  }, [graphData.nodes.length, setScanning, setLastScan]);

  const handleShowRepoSelector = useCallback(() => {
    setShowRepoSelector(true);
  }, [setShowRepoSelector]);

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

  const handleClearData = useCallback(async () => {
    if (!selectedRepo) {
      alert('Please select a repository first');
      return;
    }

    const repoLabel = selectedRepo
      ? (repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop())
      : null;

    const confirmed = window.confirm(
      `Are you sure you want to delete all analysis data for "${repoLabel ?? 'this repo'}"? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const res = await fetch('/api/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: selectedRepo })
      });

      if (res.ok) {
        const data = await res.json();
        alert(`Deleted ${data.deleted} analyses. The graph will refresh.`);
        // Reload to refresh the dashboard
        window.location.reload();
      } else {
        alert('Error clearing data');
      }
    } catch (e) {
      console.error('Clear failed:', e);
      alert('Error clearing data');
    }
  }, [selectedRepo, repos]);

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
          onClick={handleShowRepoSelector}
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

        <button
          onClick={handleClearData}
          disabled={!selectedRepo || wsStatus !== 'connected'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: !selectedRepo ? '#1e293b' : '#7f1d1d',
            border: `1px solid ${!selectedRepo ? '#334155' : '#991b1b'}`,
            borderRadius: 6, color: !selectedRepo ? '#475569' : '#fee2e2',
            cursor: !selectedRepo ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 600, padding: '6px 14px',
            letterSpacing: 0.2, transition: 'all 0.15s'
          }}
        >
          <span>🗑</span>
          Clear Data
        </button>
      </header>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Main area ──────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <GraphView
          graphData={graphData}
          onNodeClick={handleNodeSelect}
          highlightNodeId={selectedNode?.id}
          selectedRepo={selectedRepo}
        />
        <Sidebar
          graphData={graphData}
          selectedNode={selectedNode}
          onClearSelection={handleClearSelection}
          onNodeSelect={handleNodeSelect}
        />
      </div>

      {/* ── Repo selector modal ─────────────────────────────── */}
      {showRepoSelector && (
        <RepoSelectorModal
          repos={repos}
          selectedRepo={selectedRepo}
          onSelect={handleRepoSelect}
          onClose={handleShowRepoSelector}
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

interface RepoSelectorModalProps {
  repos: RepoInfo[];
  selectedRepo: string | null;
  onSelect: (repo: string) => void;
  onClose: () => void;
}

function RepoSelectorModal({ repos, selectedRepo, onSelect, onClose }: RepoSelectorModalProps) {
  const handleDomEvent = useCallback(
    (e: React.MouseEvent) => {
      if (e.currentTarget === e.target) {
        onClose();
      } else {
        e.stopPropagation();
      }
    },
    [onClose]
  );

  return (
    <div
      onClick={handleDomEvent}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div
        onClick={handleDomEvent}
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
            <RepoButton
              key={r.repoRoot}
              repo={r}
              isSelected={selectedRepo === r.repoRoot}
              onSelect={onSelect}
            />
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

interface RepoButtonProps {
  repo: RepoInfo;
  isSelected: boolean;
  onSelect: (repo: string) => void;
}

function RepoButton({ repo, isSelected, onSelect }: RepoButtonProps) {
  const handleClick = useCallback(() => {
    onSelect(repo.repoRoot);
  }, [repo.repoRoot, onSelect]);

  return (
    <button
      onClick={handleClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: isSelected ? '#1e3a5f' : '#0d1526',
        border: `1px solid ${isSelected ? '#3b82f6' : '#1e293b'}`,
        borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
        color: '#f1f5f9', textAlign: 'left', transition: 'all 0.12s'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{repo.label}</span>
          {repo.sessionType && repo.sessionType !== 'unknown' && (
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
              padding: '1px 6px', borderRadius: 4,
              background: repo.sessionType === 'claude' ? '#1e3a5f' : '#14532d',
              color: repo.sessionType === 'claude' ? '#93c5fd' : '#86efac',
              border: `1px solid ${repo.sessionType === 'claude' ? '#2563eb' : '#16a34a'}`
            }}>
              {repo.sessionType === 'claude' ? 'Claude' : 'Copilot'}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {repo.repoRoot}
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginLeft: 16, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {repo.fileCount} file{repo.fileCount !== 1 ? 's' : ''}
      </div>
    </button>
  );
}
