import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VisGraphView } from './components/VisGraphView';
import { DetailPanel } from './components/DetailPanel';
import { FileListDrawer } from './components/FileListDrawer';
import { ViolationsPanel } from './components/ViolationsPanel';
import { GraphData, GraphNode, GraphEdge, RepoInfo, WSMessage, ExcludePattern } from './types';
import { useTheme, ratingColor as themeRatingColor } from './ThemeContext';
interface ScanExcludePatterns {
    global: string[];
    csharp: string[];
    typescript: string[];
}

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

function ratingColor(r: number, T: ReturnType<typeof useTheme>['T']): string {
    return themeRatingColor(r, T);
}

// ── Design tokens ──────────────────────────────────────────

// ── Brand icons ────────────────────────────────────────────
function ClaudeIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M16.1 3.68l-4.03 16.58a.59.59 0 0 1-.57.46.6.6 0 0 1-.14-.02.59.59 0 0 1-.44-.71L14.95 3.4a.59.59 0 0 1 1.15.28zM8.52 5.12l2.72 4.17-2.1 3.5-4.63-7.67a.59.59 0 0 1 1.01-.59l2.05 3.4L8.52 5.12zm7.69 6.79L21.03 19a.59.59 0 0 1-1.01.6l-4.63-7.68 2.1-3.5-.56.94.33.55-1.05 1.99z" fill="#D97757" />
        </svg>
    );
}

function CopilotIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5zm4 4h-2v-2h2v2zm0-4h-2V7h2v5z" fill="#86EFAC" />
            <path d="M12 4c-1.1 0-2.1.23-3.06.63C10.58 5.54 12 7.6 12 10c0 2.4-1.42 4.46-3.06 5.37A7.96 7.96 0 0 0 12 20a8 8 0 0 0 0-16z" fill="#22C55E" />
            <circle cx="9.5" cy="11" r="1.5" fill="#0B1120" />
            <circle cx="14.5" cy="11" r="1.5" fill="#0B1120" />
        </svg>
    );
}

// Custom hook: WebSocket connection & message handling
function useWebSocketConnection(selectedRepo: string | null, onRepoCreated?: () => void) {
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [scanProgress, setScanProgress] = useState<{ analyzed: number; total: number } | null>(null);
    const [repoLoading, setRepoLoading] = useState(false);

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

        setRepoLoading(true);
        setGraphData({ nodes: [], edges: [] });

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
                    setRepoLoading(false);
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
                    setScanning(false);
                    setLastScan({ fileCount: msg.scanAnalyzed ?? analyzedRef.current, ts: Date.now() });
                } else if (msg.type === 'repo_created') {
                    onRepoCreatedRef.current?.();
                }
            } catch { /* WebSocket message parse error — non-critical */ }
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

    return { graphData, wsStatus, scanProgress, scanningRef, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading };
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
            .catch(() => { /* repo fetch failed — will retry on next render */ });
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

// Custom hook: Node selection handlers
function useNodeHandlers(graphData: GraphData) {
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

    // Keep selectedNode in sync with latest graph data
    useEffect(() => {
        if (selectedNode) {
            const updated = graphData.nodes.find(n => n.id === selectedNode.id);
            if (updated && updated !== selectedNode) setSelectedNode(updated);
            else if (!updated) setSelectedNode(null);
        }
    }, [graphData.nodes]);

    return {
        selectedNode,
        handleClearSelection: useCallback(() => setSelectedNode(null), []),
        handleNodeSelect: useCallback((node: GraphNode) => setSelectedNode(node), []),
    };
}

/** Convert a simple glob pattern to a RegExp. Supports * and ** wildcards. */
function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__GLOBSTAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__GLOBSTAR__/g, '.*');
    return new RegExp(escaped, 'i');
}

function matchesAnyPattern(filePath: string, patterns: ExcludePattern[]): boolean {
    const fileName = filePath.split('/').pop() ?? filePath;
    return patterns.some(p => {
        const re = globToRegex(p.pattern);
        return re.test(filePath) || re.test(fileName);
    });
}

// Custom hook: Exclude patterns management
function useExcludePatterns(selectedRepo: string | null, graphData: GraphData) {
    const [patterns, setPatterns] = useState<ExcludePattern[]>([]);

    const load = useCallback(() => {
        if (!selectedRepo) { setPatterns([]); return; }
        fetch(`/api/exclude-patterns?repo=${encodeURIComponent(selectedRepo)}`)
            .then(r => r.json())
            .then(data => setPatterns(Array.isArray(data) ? data : []))
            .catch(() => { setPatterns([]); /* API unreachable — reset to empty */ });
    }, [selectedRepo]);

    useEffect(() => { load(); }, [load]);

    const addPattern = useCallback(async (pattern: string, label?: string) => {
        if (!selectedRepo || !pattern.trim()) return;
        await fetch('/api/exclude-patterns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: selectedRepo, pattern: pattern.trim(), label }),
        });
        load();
    }, [selectedRepo, load]);

    const removePattern = useCallback(async (id: number) => {
        await fetch(`/api/exclude-patterns/${id}`, { method: 'DELETE' });
        load();
    }, [load]);

    const [scanExcludePatterns, setScanExcludePatterns] = useState<ScanExcludePatterns | null>(null);

    useEffect(() => {
        fetch('/api/scan-config')
            .then(r => r.json())
            .then(data => setScanExcludePatterns(data.scanExcludePatterns ?? null))
            .catch(() => { setScanExcludePatterns(null); /* config fetch failed */ });
    }, []);

    const filteredGraphData = useMemo<GraphData>(() => {
        if (patterns.length === 0) return graphData;
        const excludedIds = new Set<string>();
        for (const node of graphData.nodes) {
            if (matchesAnyPattern(node.id, patterns)) excludedIds.add(node.id);
        }
        if (excludedIds.size === 0) return graphData;
        return {
            nodes: graphData.nodes.filter(n => !excludedIds.has(n.id)),
            edges: graphData.edges.filter(e => {
                const s = typeof e.source === 'string' ? e.source : e.source?.id;
                const t = typeof e.target === 'string' ? e.target : e.target?.id;
                return !excludedIds.has(s) && !excludedIds.has(t);
            }),
        };
    }, [graphData, patterns]);

    return { filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns };
}

// Custom hook: Search UI state and handlers
function useSearchUI(nodes: GraphNode[], onNodeSelect: (node: GraphNode) => void) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return nodes
            .filter(n => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
            .slice(0, 8);
    }, [searchQuery, nodes]);

    const showSearchDropdown = searchFocused && searchQuery.trim().length > 0 && searchResults.length > 0;

    const handleSearchSelect = useCallback((node: GraphNode) => {
        onNodeSelect(node);
        setSearchQuery('');
        setSearchFocused(false);
        searchRef.current?.blur();
    }, [onNodeSelect]);

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    }, []);

    const handleSearchFocus = useCallback(() => setSearchFocused(true), []);

    const handleSearchBlur = useCallback(() => {
        setTimeout(() => setSearchFocused(false), 150);
    }, []);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setSearchQuery('');
            searchRef.current?.blur();
        }
    }, []);

    return {
        searchQuery,
        searchRef,
        searchResults,
        showSearchDropdown,
        handleSearchSelect,
        handleSearchChange,
        handleSearchFocus,
        handleSearchBlur,
        handleSearchKeyDown,
    };
}

function usePanelActions(
    handleClearSelection: () => void,
    handleNodeSelect: (node: GraphNode) => void,
    setShowRepoSelector: React.Dispatch<React.SetStateAction<boolean>>,
    filteredGraphData: GraphData,
    setScanning: React.Dispatch<React.SetStateAction<boolean>>,
    setLastScan: React.Dispatch<React.SetStateAction<{ fileCount: number; ts: number } | null>>,
) {
    const [showFileList, setShowFileList] = useState(false);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showViolationsPanel, setShowViolationsPanel] = useState(false);

    useEffect(() => {
        const handleScanComplete = () => {
            setScanning(false);
            setLastScan({ fileCount: filteredGraphData.nodes.length, ts: Date.now() });
        };
    }, [filteredGraphData.nodes.length, setScanning, setLastScan]);

    const handleShowRepoSelector = useCallback(() => {
        setShowRepoSelector(true);
    }, [setShowRepoSelector]);

    const handleFileListOpen = useCallback(() => {
        setShowFileList(true);
        setShowFilterPanel(false);
        setShowViolationsPanel(false);
        handleClearSelection();
    }, [handleClearSelection]);

    const handleFileListSelect = useCallback((node: GraphNode) => {
        handleNodeSelect(node);
        setShowFileList(false);
    }, [handleNodeSelect]);

    const handleFileListClose = useCallback(() => setShowFileList(false), []);

    const handleToggleFilterPanel = useCallback(() => {
        setShowFilterPanel(p => !p);
        setShowFileList(false);
        setShowViolationsPanel(false);
    }, []);

    const handleCloseFilterPanel = useCallback(() => setShowFilterPanel(false), []);

    const handleToggleViolationsPanel = useCallback(() => {
        setShowViolationsPanel(p => !p);
        setShowFileList(false);
        setShowFilterPanel(false);
    }, []);

    const handleCloseViolationsPanel = useCallback(() => setShowViolationsPanel(false), []);

    return {
        showFileList, showFilterPanel, showViolationsPanel,
        handleShowRepoSelector, handleFileListOpen, handleFileListSelect,
        handleFileListClose, handleToggleFilterPanel, handleCloseFilterPanel,
        handleToggleViolationsPanel, handleCloseViolationsPanel,
    };
}

export default function App() {
    const { T } = useTheme();
    const {
        repos,
        selectedRepo,
        showRepoSelector,
        setShowRepoSelector,
        handleRepoSelect,
        refreshRepos,
    } = useRepoSelection();

    const { graphData, wsStatus, scanProgress, scanningRef, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading } = useWebSocketConnection(selectedRepo, refreshRepos);
    const { filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns } = useExcludePatterns(selectedRepo, graphData);

    const { selectedNode, handleClearSelection, handleNodeSelect } = useNodeHandlers(filteredGraphData);

    const {
        searchQuery, searchRef, searchResults, showSearchDropdown,
        handleSearchSelect, handleSearchChange, handleSearchFocus,
        handleSearchBlur, handleSearchKeyDown,
    } = useSearchUI(filteredGraphData.nodes, handleNodeSelect);

    const {
        showFileList, showFilterPanel, showViolationsPanel,
        handleShowRepoSelector, handleFileListOpen, handleFileListSelect,
        handleFileListClose, handleToggleFilterPanel, handleCloseFilterPanel,
        handleToggleViolationsPanel, handleCloseViolationsPanel,
    } = usePanelActions(handleClearSelection, handleNodeSelect, setShowRepoSelector, filteredGraphData, setScanning, setLastScan);

    // Stats
    const totalViolations = filteredGraphData.nodes.reduce((a, n) => a + n.violations.length, 0);
    const overallRating = filteredGraphData.nodes.length > 0
        ? (filteredGraphData.nodes.reduce((a, n) => a + n.rating, 0) / filteredGraphData.nodes.length)
        : null;

    const statusDot = { connecting: '#EAB308', connected: '#22C55E', disconnected: '#EF4444' }[wsStatus];
    const currentRepoLabel = selectedRepo
        ? (repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop())
        : null;

    const handleClearData = async () => {
        if (!selectedRepo) { alert('Please select a repository first'); return; }
        const repoLabel = repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop();
        if (!window.confirm(`Delete all analysis data for "${repoLabel}"? This cannot be undone.`)) return;
        try {
            const res = await fetch('/api/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo: selectedRepo }),
            });
            if (res.ok) {
                const data = await res.json();
                alert(`Deleted ${data.deleted} analyses.`);
                window.location.reload();
            } else { alert('Error clearing data'); }
        } catch { alert('Error clearing data'); }
    };

    // Scan progress percentage
    const scanPct = scanProgress && scanProgress.total > 0
        ? Math.round((scanProgress.analyzed / scanProgress.total) * 100)
        : null;

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', height: '100vh',
            background: T.bg, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
        }}>

            {/* ── Scan progress bar (top edge) ───────────────────── */}
            {scanning && (
                <div style={{ height: 3, background: T.border, flexShrink: 0, overflow: 'hidden' }}>
                    <div style={{
                        height: '100%', background: T.accent, transition: 'width 0.3s ease',
                        width: scanPct != null ? `${scanPct}%` : '30%',
                        animation: scanPct == null ? 'progressPulse 1.5s ease-in-out infinite' : 'none',
                    }} />
                </div>
            )}

            {/* ── Header ─────────────────────────────────────────── */}
            <header style={{
                height: 48, minHeight: 48, background: T.bg,
                borderBottom: `1px solid ${T.border}`,
                display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
                zIndex: 30, flexShrink: 0,
            }}>
                {/* Logo + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 16, color: T.accent }}>⬡</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>Gate Keeper</span>
                    <span style={{
                        width: 6, height: 6, borderRadius: '50%', background: statusDot,
                        display: 'inline-block', marginLeft: 2,
                    }} />
                </div>

                <Divider />

                {/* Repo selector */}
                <button
                    onClick={handleShowRepoSelector}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        background: T.border, border: `1px solid ${T.borderBright}`,
                        borderRadius: 6, color: currentRepoLabel ? T.textMuted : T.textDim,
                        cursor: 'pointer', fontSize: 12, padding: '4px 10px',
                        maxWidth: 180, overflow: 'hidden', flexShrink: 0,
                    }}
                >
                    <span style={{ color: T.accent, fontSize: 10 }}>◈</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {currentRepoLabel ?? 'All repos'}
                    </span>
                    {repos.length > 1 && <span style={{ color: T.textDim, marginLeft: 2 }}>▾</span>}
                </button>

                <Divider />

                {/* Search */}
                <div style={{ position: 'relative', flex: '0 1 260px', minWidth: 140 }}>
                    <span style={{
                        position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                        fontSize: 12, color: T.textDim, pointerEvents: 'none',
                    }}>⌕</span>
                    <input
                        ref={searchRef}
                        type="text"
                        value={searchQuery}
                        onChange={handleSearchChange}
                        onFocus={handleSearchFocus}
                        onBlur={handleSearchBlur}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search files…"
                        style={{
                            width: '100%', padding: '5px 10px 5px 28px',
                            background: T.panel, border: `1px solid ${T.border}`,
                            borderRadius: 6, color: T.text, fontSize: 12, outline: 'none',
                        }}
                    />
                    {/* Search dropdown */}
                    {showSearchDropdown && (
                        <div className="fade-in" style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                            background: T.panel, border: `1px solid ${T.borderBright}`,
                            borderRadius: 8, overflow: 'hidden', zIndex: 50,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        }}>
                            {searchResults.map(node => (
                                <SearchResultItem key={node.id} node={node} onSelect={handleSearchSelect} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginLeft: 4 }}>
                    <HeaderStat label="Files" value={filteredGraphData.nodes.length} color={T.textMuted} />
                    {overallRating != null && (
                        <HeaderStat label="Score" value={`${overallRating.toFixed(1)}`} color={ratingColor(overallRating, T)} bold />
                    )}
                    <HeaderStat label="Issues" value={totalViolations} color={totalViolations > 0 ? T.red : T.green} onClick={handleToggleViolationsPanel} />
                    {patterns.length > 0 && (
                        <HeaderStat label="Excluded" value={graphData.nodes.length - filteredGraphData.nodes.length} color={T.textDim} />
                    )}
                </div>

                <div style={{ flex: 1 }} />

                {/* Action buttons */}
                <HeaderButton
                    label={`⚙ Filters${patterns.length > 0 ? ` (${patterns.length})` : ''}`}
                    onClick={handleToggleFilterPanel}
                    disabled={!selectedRepo}
                    title="Manage exclude patterns"
                />
                <HeaderButton
                    label="📋 Files"
                    onClick={handleFileListOpen}
                    disabled={filteredGraphData.nodes.length === 0}
                />
                {scanning ? (
                    <ScanProgressIndicator
                        analyzed={scanProgress?.analyzed ?? 0}
                        total={scanProgress?.total ?? 0}
                    />
                ) : (
                    <HeaderButton
                        label="⟳ Scan"
                        onClick={handleScanAll}
                        disabled={wsStatus !== 'connected'}
                        primary
                    />
                )}
                <HeaderButton
                    label="🗑"
                    onClick={handleClearData}
                    disabled={!selectedRepo || wsStatus !== 'connected'}
                    danger
                    title="Clear all data"
                />
                <ThemeToggleButton />
            </header>

            {/* ── Main area (graph + overlays) ──────────────────── */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
                {repoLoading ? (
                    <RepoLoadingOverlay />
                ) : (
                    <VisGraphView
                        graphData={filteredGraphData}
                        onNodeClick={handleNodeSelect}
                        onCanvasClick={handleClearSelection}
                        highlightNodeId={selectedNode?.id}
                        selectedRepo={selectedRepo}
                        focusNodeId={selectedNode?.id}
                        scanning={scanning}
                    />
                )}

                {/* Detail panel overlay */}
                {!repoLoading && selectedNode && !showFileList && !showFilterPanel && (
                    <DetailPanel
                        node={selectedNode}
                        graphData={filteredGraphData}
                        onClose={handleClearSelection}
                        onNodeSelect={handleNodeSelect}
                    />
                )}

                {/* File list drawer overlay */}
                {!repoLoading && showFileList && (
                    <FileListDrawer
                        graphData={filteredGraphData}
                        onNodeSelect={handleFileListSelect}
                        onClose={handleFileListClose}
                    />
                )}

                {/* Filter panel overlay */}
                {!repoLoading && showFilterPanel && selectedRepo && (
                    <FilterPanel
                        patterns={patterns}
                        onAdd={addPattern}
                        onRemove={removePattern}
                        onClose={handleCloseFilterPanel}
                        excludedCount={graphData.nodes.length - filteredGraphData.nodes.length}
                        totalCount={graphData.nodes.length}
                        scanExcludePatterns={scanExcludePatterns}
                    />
                )}

                {/* Violations panel overlay */}
                {!repoLoading && showViolationsPanel && (
                    <ViolationsPanel
                        graphData={filteredGraphData}
                        onClose={handleCloseViolationsPanel}
                        T={T}
                    />
                )}
            </div>

            {/* ── Repo selector modal ─────────────────────────── */}
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

// ── Shared sub-components ──────────────────────────────────

function RepoLoadingOverlay() {
    const { T } = useTheme();

    return (
        <div style={{
            display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center',
            background: T.bg,
        }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{
                    width: 40, height: 40, border: `3px solid ${T.border}`,
                    borderTopColor: T.accent, borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ fontSize: 13, color: T.textMuted, fontWeight: 500 }}>
                    Loading repository…
                </span>
            </div>
        </div>
    );
}

function SearchResultItem({ node, onSelect }: { node: GraphNode; onSelect: (node: GraphNode) => void }) {
    const { T } = useTheme();
    const handleMouseDown = useCallback(() => onSelect(node), [node, onSelect]);

    return (
        <div
            className="search-result-item"
            onMouseDown={handleMouseDown}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${T.border}`,
            }}
        >
            <span style={{ fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.label}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: ratingColor(node.rating, T), marginLeft: 8, flexShrink: 0 }}>
                {node.rating}
            </span>
        </div>
    );
}

function ThemeToggleButton() {
    const { mode, toggleTheme, T } = useTheme();
    const isDark = mode === 'dark';
    return (
        <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30,
                background: T.panel, border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.textMuted,
                cursor: 'pointer', fontSize: 14, flexShrink: 0,
                transition: 'all 0.12s',
            }}
        >
            {isDark ? '☀️' : '🌙'}
        </button>
    );
}

function Divider() {
    const { T } = useTheme();
    return <div style={{ width: 1, height: 20, background: T.border, flexShrink: 0 }} />;
}

function HeaderStat({ label, value, color, bold, onClick }: {
    label: string; value: number | string; color: string; bold?: boolean; onClick?: () => void;
}) {
    const { T } = useTheme();

    return (
        <div
            onClick={onClick}
            style={{
                display: 'flex', flexDirection: 'column', lineHeight: 1, flexShrink: 0,
                cursor: onClick ? 'pointer' : 'default',
                padding: onClick ? '2px 4px' : undefined,
                borderRadius: onClick ? 4 : undefined,
            }}
        >
            <span style={{ fontSize: 9, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>
                {label}
            </span>
            <span style={{ fontSize: 15, fontWeight: bold ? 700 : 600, color }}>{value}</span>
        </div>
    );
}

function ScanProgressIndicator({ analyzed, total }: { analyzed: number; total: number }) {
    const { T } = useTheme();
    const pct = total > 0 ? Math.round((analyzed / total) * 100) : 0;
    const label = total > 0
        ? `Analyzing ${analyzed}/${total} files (${pct}%)`
        : 'Discovering files…';

    return (
        <div
            title={label}
            style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: T.panel, border: `1px solid ${T.accent}`,
                borderRadius: 6, padding: '5px 12px', flexShrink: 0, minWidth: 180,
            }}
        >
            {/* Pulsing dot */}
            <span style={{
                width: 7, height: 7, borderRadius: '50%', background: T.accent,
                animation: 'progressPulse 1.2s ease-in-out infinite', flexShrink: 0,
            }} />

            {/* Text info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.accent, whiteSpace: 'nowrap' }}>
                        {total > 0 ? `${analyzed} / ${total} files` : 'Scanning…'}
                    </span>
                    {total > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, marginLeft: 6 }}>
                            {pct}%
                        </span>
                    )}
                </div>

                {/* Mini progress bar */}
                <div style={{
                    height: 3, background: T.borderBright, borderRadius: 2, overflow: 'hidden',
                }}>
                    <div style={{
                        height: '100%', borderRadius: 2,
                        background: T.accent,
                        transition: 'width 0.3s ease',
                        width: total > 0 ? `${pct}%` : '40%',
                        animation: total === 0 ? 'progressPulse 1.5s ease-in-out infinite' : 'none',
                    }} />
                </div>
            </div>
        </div>
    );
}

function HeaderButton({ label, onClick, disabled, primary, danger, title }: {
    label: string; onClick: () => void; disabled?: boolean;
    primary?: boolean; danger?: boolean; title?: string;
}) {
    const { T } = useTheme();

    let bg = T.panel;
    let borderColor = T.border;
    let textColor = T.textMuted;

    if (primary && !disabled) { bg = T.accentDim; borderColor = T.accent; textColor = '#EFF6FF'; }
    if (danger && !disabled) { bg = '#7F1D1D'; borderColor = '#991B1B'; textColor = '#FEE2E2'; }
    if (disabled) { bg = T.panel; borderColor = T.border; textColor = T.textDim; }

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: bg, border: `1px solid ${borderColor}`,
                borderRadius: 6, color: textColor,
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 600, padding: '5px 10px',
                transition: 'all 0.12s', flexShrink: 0,
            }}
        >
            {label}
        </button>
    );
}

interface RepoSelectorModalProps {
    repos: RepoInfo[];
    selectedRepo: string | null;
    onSelect: (repo: string) => void;
    onClose: () => void;
}

function RepoSelectorModal({ repos, selectedRepo, onSelect, onClose }: RepoSelectorModalProps) {
    const { T } = useTheme();
    const handleDomEvent = useCallback(
        (e: React.MouseEvent) => {
            if (e.currentTarget === e.target) onClose();
            else e.stopPropagation();
        },
        [onClose]
    );

    return (
        <div
            onClick={handleDomEvent}
            style={{
                position: 'fixed', inset: 0, zIndex: 100,
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
        >
            <div
                onClick={handleDomEvent}
                className="fade-in"
                style={{
                    background: T.bg, border: `1px solid ${T.border}`,
                    borderRadius: 12, padding: 24, minWidth: 360, maxWidth: 520,
                    boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                }}
            >
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                    Select Repository
                </div>
                <div style={{ fontSize: 12, color: T.textDim, marginBottom: 20 }}>
                    Pick a repository to view its dependency map.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {repos.map(r => (
                        <RepoButton key={r.repoRoot} repo={r} isSelected={selectedRepo === r.repoRoot} onSelect={onSelect} />
                    ))}
                </div>

                <button
                    onClick={onClose}
                    style={{
                        marginTop: 16, width: '100%', padding: '8px 0',
                        background: 'transparent', border: `1px solid ${T.border}`,
                        borderRadius: 6, color: T.textDim, cursor: 'pointer', fontSize: 12,
                    }}
                >
                    Cancel
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
    const { T } = useTheme();
    const handleClick = useCallback(() => onSelect(repo.repoRoot), [repo.repoRoot, onSelect]);

    return (
        <button
            onClick={handleClick}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: isSelected ? T.accentDim : T.panel,
                border: `1px solid ${isSelected ? T.accent : T.border}`,
                borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                color: T.text, textAlign: 'left', transition: 'all 0.12s',
            }}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    {repo.sessionType && repo.sessionType !== 'unknown' && (
                        repo.sessionType === 'claude'
                            ? <ClaudeIcon size={18} />
                            : <CopilotIcon size={18} />
                    )}
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{repo.label}</span>
                    {repo.sessionType && repo.sessionType !== 'unknown' && (
                        <span style={{
                            fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
                            padding: '1px 6px', borderRadius: 4,
                            background: T.accentDim,
                            color: T.accent,
                            border: `1px solid ${T.accent}`,
                        }}>
                            {repo.sessionType === 'claude' ? 'Claude' : 'Copilot'}
                        </span>
                    )}
                </div>
                <div style={{ fontSize: 11, color: T.textDim, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {repo.repoRoot}
                </div>
            </div>
            <div style={{ fontSize: 12, color: T.textFaint, marginLeft: 16, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {repo.fileCount} file{repo.fileCount !== 1 ? 's' : ''}
            </div>
        </button>
    );
}

// ── Predefined filter presets ──────────────────────────────
const FILTER_PRESETS: Array<{ label: string; pattern: string }> = [
    { label: 'EF Core Migrations', pattern: '**/Migrations/**' },
    { label: 'Migration files (date prefix)', pattern: '*_*.Designer.cs' },
    { label: 'Designer generated', pattern: '*.Designer.cs' },
    { label: 'Auto-generated', pattern: '*.g.cs' },
    { label: 'AssemblyInfo', pattern: '**/AssemblyInfo.cs' },
    { label: 'GlobalUsings', pattern: '**/GlobalUsings.cs' },
    { label: 'Test files', pattern: '**/*Tests*' },
    { label: 'Spec files', pattern: '**/*.spec.*' },
    { label: 'Declaration files', pattern: '**/*.d.ts' },
    { label: 'Config files', pattern: '**/*.config.*' },
];

interface FilterPanelProps {
    patterns: ExcludePattern[];
    onAdd: (pattern: string, label?: string) => void;
    onRemove: (id: number) => void;
    onClose: () => void;
    excludedCount: number;
    totalCount: number;
    scanExcludePatterns: ScanExcludePatterns | null;
}

function PresetButton({ preset, active, onAdd, patterns }: {
    preset: { label: string; pattern: string };
    active: boolean;
    onAdd: (pattern: string, label?: string) => void;
    patterns: ExcludePattern[];
}) {
    const { T } = useTheme();

    const handleClick = useCallback(() => {
        if (patterns.some(p => p.pattern === preset.pattern)) return;
        onAdd(preset.pattern, preset.label);
    }, [preset, onAdd, patterns]);

    return (
        <button
            onClick={handleClick}
            style={{
                padding: '4px 10px', borderRadius: 14,
                background: active ? T.accentDim : T.panel,
                border: `1px solid ${active ? T.accent : T.border}`,
                color: active ? T.accent : T.textMuted,
                cursor: active ? 'default' : 'pointer',
                fontSize: 11, transition: 'all 0.12s',
                opacity: active ? 0.8 : 1,
            }}
        >
            {active ? '✓ ' : ''}{preset.label}
        </button>
    );
}

function PatternItem({ pattern, onRemove }: { pattern: ExcludePattern; onRemove: (id: number) => void }) {
    const { T } = useTheme();
    const handleRemove = useCallback(() => onRemove(pattern.id), [pattern.id, onRemove]);

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderRadius: 6,
            background: T.panel, border: `1px solid ${T.border}`,
        }}>
            <div style={{ minWidth: 0 }}>
                <div style={{
                    fontSize: 12, color: T.text, fontFamily: 'monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {pattern.pattern}
                </div>
                {pattern.label && (
                    <div style={{ fontSize: 10, color: T.textDim, marginTop: 1 }}>{pattern.label}</div>
                )}
            </div>
            <button
                onClick={handleRemove}
                style={{
                    background: 'none', border: 'none', color: T.red,
                    cursor: 'pointer', fontSize: 14, padding: '2px 6px',
                    borderRadius: 4, marginLeft: 8, flexShrink: 0,
                }}
                title="Remove pattern"
            >✕</button>
        </div>
    );
}

function FilterPanel({ patterns, onAdd, onRemove, onClose, excludedCount, totalCount, scanExcludePatterns }: FilterPanelProps) {
    const { T } = useTheme();
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFormSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const input = inputRef.current;
        if (!input || !input.value.trim()) return;
        onAdd(input.value.trim());
        input.value = '';
        input.focus();
    }, [onAdd]);

    const activePresets = new Set(patterns.map(p => p.pattern));

    return (
        <div
            className="slide-in-right"
            style={{
                position: 'absolute', top: 0, right: 0, bottom: 0,
                width: 380, maxWidth: '90vw',
                background: T.bg, borderLeft: `1px solid ${T.border}`,
                display: 'flex', flexDirection: 'column', zIndex: 40,
                boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
            }}
        >
            {/* Header */}
            <div style={{
                padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Exclude Filters</div>
                    <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>
                        {excludedCount > 0
                            ? `Hiding ${excludedCount} of ${totalCount} files`
                            : 'Hide files by pattern'}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none', border: 'none', color: T.textDim,
                        cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1,
                    }}
                >✕</button>
            </div>

            {/* Add pattern */}
            <form onSubmit={handleFormSubmit} style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, color: T.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Custom Pattern
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input
                        ref={inputRef}
                        type="text"
                        name="pattern"
                        placeholder="e.g. **/Migrations/** or *_Migration*"
                        style={{
                            flex: 1, padding: '7px 10px',
                            background: T.panel, border: `1px solid ${T.border}`,
                            borderRadius: 6, color: T.text, fontSize: 12, outline: 'none',
                        }}
                    />
                    <button
                        type="submit"
                        style={{
                            padding: '7px 14px', background: T.accentDim,
                            border: `1px solid ${T.accent}`, borderRadius: 6,
                            color: '#EFF6FF', cursor: 'pointer',
                            fontSize: 12, fontWeight: 600,
                        }}
                    >Add</button>
                </div>
                <div style={{ fontSize: 10, color: T.textDim, marginTop: 4 }}>
                    Glob syntax: <code style={{ color: T.textFaint }}>*</code> matches filename chars,{' '}
                    <code style={{ color: T.textFaint }}>**</code> matches paths
                </div>
            </form>

            {/* Quick presets */}
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, color: T.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Quick Presets
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {FILTER_PRESETS.map(preset => (
                        <PresetButton
                            key={preset.pattern}
                            preset={preset}
                            active={activePresets.has(preset.pattern)}
                            onAdd={onAdd}
                            patterns={patterns}
                        />
                    ))}
                </div>
            </div>

            {/* Active patterns list */}
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
                <div style={{ fontSize: 11, color: T.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Active Filters ({patterns.length})
                </div>
                {patterns.length === 0 ? (
                    <div style={{ fontSize: 12, color: T.textDim, padding: '20px 0', textAlign: 'center' }}>
                        No exclude patterns configured.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {patterns.map(p => (
                            <PatternItem key={p.id} pattern={p} onRemove={onRemove} />
                        ))}
                    </div>
                )}
            </div>

            {/* Scan-level patterns (from ~/.gate-keeper/config.json) */}
            {scanExcludePatterns && (
                <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 11, color: T.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Scan-Level Excludes <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>(~/.gate-keeper/config.json)</span>
                    </div>
                    <div style={{ fontSize: 10, color: T.textDim, marginBottom: 6 }}>
                        Files matching these patterns are never scanned. Edit the config file to change.
                    </div>
                    {(['global', 'csharp', 'typescript'] as const).map(lang => {
                        const list = scanExcludePatterns[lang];
                        if (!list || list.length === 0) return null;
                        const langLabel = lang === 'global' ? 'All Languages' : lang === 'csharp' ? 'C# / .NET' : 'TypeScript / JS';
                        return (
                            <div key={lang} style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 3, fontWeight: 600 }}>{langLabel}</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {list.map(p => (
                                        <span key={p} style={{
                                            padding: '2px 8px', borderRadius: 10,
                                            background: T.elevated, border: `1px solid ${T.border}`,
                                            color: T.textDim, fontSize: 10, fontFamily: 'monospace',
                                        }}>{p}</span>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
