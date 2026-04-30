import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ExcludePattern,
    GateKeeperConfig,
    GraphData,
    GraphEdge,
    GraphNode,
    RepoInfo,
    ScanLogEntry,
    WSMessage,
} from '../types';

export interface ScanExcludePatterns {
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

export function useResizable(initialWidth: number, minWidth = 300, maxWidth = 900) {
    const [width, setWidth] = useState(initialWidth);
    const dragging = useRef(false);
    const startX = useRef(0);
    const startW = useRef(0);

    const onResizeStart = useCallback((e: React.MouseEvent) => {
        dragging.current = true;
        startX.current = e.clientX;
        startW.current = width;
        e.preventDefault();
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [width]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragging.current) return;
            const delta = startX.current - e.clientX;
            setWidth(Math.max(minWidth, Math.min(maxWidth, startW.current + delta)));
        };
        const onUp = () => {
            if (dragging.current) {
                dragging.current = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    }, [minWidth, maxWidth]);

    return { width, onResizeStart };
}

export function useWebSocketConnection(selectedRepo: string | null, onRepoCreated?: () => void) {
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [scanProgress, setScanProgress] = useState<{ analyzed: number; total: number } | null>(null);
    const [repoLoading, setRepoLoading] = useState(false);
    const [scanLogs, setScanLogs] = useState<ScanLogEntry[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scanningRef = useRef(false);
    const analyzedRef = useRef(0);
    const scanTotalRef = useRef(0);
    const onRepoCreatedRef = useRef(onRepoCreated);
    onRepoCreatedRef.current = onRepoCreated;

    const [scanning, setScanning] = useState(false);
    const [lastScan, setLastScan] = useState<{ fileCount: number; ts: number } | null>(null);
    const setScanningRef = useRef(setScanning);
    setScanningRef.current = setScanning;

    const autoScannedRef = useRef<string | null>(null);

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
                    if (repo && msg.data.nodes.length === 0 && !scanningRef.current && autoScannedRef.current !== repo) {
                        autoScannedRef.current = repo;
                        scanningRef.current = true;
                        setScanningRef.current(true);
                        fetch('/api/scan', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ repo }),
                        }).catch(() => {
                            scanningRef.current = false;
                            setScanningRef.current(false);
                        });
                    }
                } else if (msg.type === 'update' && msg.delta) {
                    setGraphData(prev => mergeGraphData(prev, msg.delta!));
                    if (scanningRef.current) {
                        analyzedRef.current += 1;
                        setScanProgress({ analyzed: analyzedRef.current, total: scanTotalRef.current });
                    }
                } else if (msg.type === 'scan_progress') {
                    analyzedRef.current = msg.scanAnalyzed ?? analyzedRef.current;
                    scanTotalRef.current = msg.scanTotal ?? scanTotalRef.current;
                    setScanProgress({ analyzed: analyzedRef.current, total: scanTotalRef.current });
                } else if (msg.type === 'scan_start') {
                    scanningRef.current = true;
                    analyzedRef.current = 0;
                    scanTotalRef.current = msg.scanTotal ?? 0;
                    setScanProgress({ analyzed: 0, total: scanTotalRef.current });
                    setScanningRef.current(true);
                    setScanLogs([{ message: `Scan started — ${msg.scanTotal ?? 0} files to analyze`, level: 'info', timestamp: Date.now() }]);
                } else if (msg.type === 'scan_complete') {
                    scanningRef.current = false;
                    setScanProgress(null);
                    setScanningRef.current(false);
                    setLastScan({ fileCount: msg.scanAnalyzed ?? analyzedRef.current, ts: Date.now() });
                    setScanLogs(prev => [...prev, { message: `Scan complete — ${msg.scanAnalyzed ?? analyzedRef.current} files analyzed`, level: 'info', timestamp: Date.now() }]);
                } else if (msg.type === 'scan_log') {
                    setScanLogs(prev => {
                        const next = [...prev, { message: msg.logMessage ?? '', level: msg.logLevel ?? 'info', timestamp: msg.logTimestamp ?? Date.now() }];
                        return next.length > 500 ? next.slice(-500) : next;
                    });
                } else if (msg.type === 'repo_created') {
                    onRepoCreatedRef.current?.();
                }
            } catch {
                // Ignore malformed ws messages.
            }
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

    const handleScanAll = useCallback(async () => {
        if (scanningRef.current) return;
        scanningRef.current = true;
        setScanning(true);
        setScanLogs([]);
        try {
            const body = selectedRepo ? JSON.stringify({ repo: selectedRepo }) : undefined;
            const res = await fetch('/api/scan', {
                method: 'POST',
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body,
            });
            if (!res.ok) {
                scanningRef.current = false;
                setScanning(false);
            }
        } catch {
            scanningRef.current = false;
            setScanning(false);
        }
    }, [selectedRepo]);

    return { graphData, wsStatus, scanProgress, scanning, lastScan, setLastScan, handleScanAll, repoLoading, scanLogs };
}

export function useRepoSelection() {
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
                    if (data.length === 1) setSelectedRepo(data[0].repoRoot);
                    else if (data.length > 1) setShowRepoSelector(true);
                }
            })
            .catch(() => {
                // Keep current repo state on fetch error.
            });
    }, []);

    useEffect(() => { loadRepos(); }, [loadRepos]);

    const handleRepoSelect = useCallback((repo: string) => {
        setSelectedRepo(repo);
        setShowRepoSelector(false);
    }, []);

    return { repos, selectedRepo, showRepoSelector, setShowRepoSelector, handleRepoSelect, refreshRepos: loadRepos };
}

export function useNodeHandlers(graphData: GraphData) {
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

    useEffect(() => {
        if (selectedNode) {
            const updated = graphData.nodes.find(n => n.id === selectedNode.id);
            if (updated && updated !== selectedNode) setSelectedNode(updated);
            else if (!updated) setSelectedNode(null);
        }
    }, [graphData.nodes, selectedNode]);

    return {
        selectedNode,
        handleClearSelection: useCallback(() => setSelectedNode(null), []),
        handleNodeSelect: useCallback((node: GraphNode) => setSelectedNode(node), []),
    };
}

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

export function useExcludePatterns(selectedRepo: string | null, graphData: GraphData) {
    const [patterns, setPatterns] = useState<ExcludePattern[]>([]);

    const load = useCallback(() => {
        if (!selectedRepo) {
            setPatterns([]);
            return;
        }
        fetch(`/api/exclude-patterns?repo=${encodeURIComponent(selectedRepo)}`)
            .then(r => r.json())
            .then(data => setPatterns(Array.isArray(data) ? data : []))
            .catch(() => { setPatterns([]); });
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
            .catch(() => { setScanExcludePatterns(null); });
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

export function useSearchUI(nodes: GraphNode[], onNodeSelect: (node: GraphNode) => void) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const q = searchQuery.toLowerCase();
        return nodes.filter(n => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).slice(0, 8);
    }, [searchQuery, nodes]);

    const showSearchDropdown = searchFocused && searchQuery.trim().length > 0 && searchResults.length > 0;

    const handleSearchSelect = useCallback((node: GraphNode) => {
        onNodeSelect(node);
        setSearchQuery('');
        setSearchFocused(false);
        searchRef.current?.blur();
    }, [onNodeSelect]);

    return {
        searchQuery,
        searchRef,
        searchResults,
        showSearchDropdown,
        handleSearchSelect,
        handleSearchChange: useCallback((e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value), []),
        handleSearchFocus: useCallback(() => setSearchFocused(true), []),
        handleSearchBlur: useCallback(() => { setTimeout(() => setSearchFocused(false), 150); }, []),
        handleSearchKeyDown: useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Escape') {
                setSearchQuery('');
                searchRef.current?.blur();
            }
        }, []),
    };
}

export function computeRepoStats(nodes: GraphNode[]): { overallRating: number | null } {
    if (nodes.length === 0) return { overallRating: null };
    const totalLoc = nodes.reduce((a, n) => a + (n.metrics.linesOfCode || 1), 0);
    const weightedSum = nodes.reduce((a, n) => a + n.rating * (n.metrics.linesOfCode || 1), 0);
    return { overallRating: Math.round((weightedSum / totalLoc) * 10) / 10 };
}

export function usePanelActions(
    handleClearSelection: () => void,
    handleNodeSelect: (node: GraphNode) => void,
    setShowRepoSelector: React.Dispatch<React.SetStateAction<boolean>>,
    filteredGraphData: GraphData,
    setLastScan: React.Dispatch<React.SetStateAction<{ fileCount: number; ts: number } | null>>,
) {
    const [showFileList, setShowFileList] = useState(false);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showViolationsPanel, setShowViolationsPanel] = useState(false);

    useEffect(() => {
        setLastScan(prev => prev ? { ...prev, fileCount: filteredGraphData.nodes.length } : prev);
    }, [filteredGraphData.nodes.length, setLastScan]);

    return {
        showFileList,
        showFilterPanel,
        showViolationsPanel,
        handleShowRepoSelector: useCallback(() => setShowRepoSelector(true), [setShowRepoSelector]),
        handleFileListOpen: useCallback(() => {
            setShowFileList(true);
            setShowFilterPanel(false);
            setShowViolationsPanel(false);
            handleClearSelection();
        }, [handleClearSelection]),
        handleFileListSelect: useCallback((node: GraphNode) => {
            handleNodeSelect(node);
            setShowFileList(false);
        }, [handleNodeSelect]),
        handleFileListClose: useCallback(() => setShowFileList(false), []),
        handleToggleFilterPanel: useCallback(() => {
            setShowFilterPanel(p => !p);
            setShowFileList(false);
            setShowViolationsPanel(false);
        }, []),
        handleCloseFilterPanel: useCallback(() => setShowFilterPanel(false), []),
        handleOpenViolations: useCallback(() => {
            setShowViolationsPanel(true);
            setShowFileList(false);
            setShowFilterPanel(false);
        }, []),
        handleCloseViolations: useCallback(() => setShowViolationsPanel(false), []),
    };
}

export function useConfigEditor() {
    const [configDraft, setConfigDraft] = useState<GateKeeperConfig | null>(null);
    const [showConfig, setShowConfig] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const openConfig = useCallback(() => {
        fetch('/api/config').then(r => r.json()).then((data: GateKeeperConfig) => {
            setConfigDraft(data);
            setShowConfig(true);
            setSaveStatus('idle');
        }).catch(() => {
            // Keep modal closed on fetch failure.
        });
    }, []);

    const saveConfig = useCallback(async () => {
        if (!configDraft) return;
        setSaving(true);
        try {
            const res = await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(configDraft),
            });
            setSaveStatus(res.ok ? 'success' : 'error');
            if (res.ok) setTimeout(() => setSaveStatus('idle'), 2000);
        } catch {
            setSaveStatus('error');
        } finally {
            setSaving(false);
        }
    }, [configDraft]);

    return {
        configDraft,
        setConfigDraft,
        showConfig,
        openConfig,
        closeConfig: useCallback(() => setShowConfig(false), []),
        saveConfig,
        saving,
        saveStatus,
    };
}
