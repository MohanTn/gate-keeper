import { useCallback, useEffect, useRef, useState } from 'react';
import { GraphData, GraphEdge, GraphNode, WSMessage } from '../types';

const edgeKey = (e: GraphEdge): string => `${typeof e.source === 'string' ? e.source : e.source?.id}→${typeof e.target === 'string' ? e.target : e.target?.id}`;

function mergeGraphData(prev: GraphData, delta: { nodes: GraphNode[]; edges: GraphEdge[] }): GraphData {
    const nodeMap = new Map(prev.nodes.map(n => [n.id, n]));
    for (const n of delta.nodes) nodeMap.set(n.id, n);
    const edgeMap = new Map(prev.edges.map(e => [edgeKey(e), e]));
    for (const e of delta.edges) edgeMap.set(edgeKey(e), e);
    return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
}

interface WsState {
    setGraphData: React.Dispatch<React.SetStateAction<GraphData>>;
    setWsStatus: React.Dispatch<React.SetStateAction<'connecting' | 'connected' | 'disconnected'>>;
    setScanProgress: React.Dispatch<React.SetStateAction<{ analyzed: number; total: number } | null>>;
    setRepoLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setScanning: React.Dispatch<React.SetStateAction<boolean>>;
    setLastScan: React.Dispatch<React.SetStateAction<{ fileCount: number; ts: number } | null>>;
    scanningRef: React.MutableRefObject<boolean>;
    analyzedRef: React.MutableRefObject<number>;
    onRepoCreatedRef: React.MutableRefObject<(() => void) | undefined>;
    reconnect: (repo: string | null) => void;
}

function handleWsMessage(event: MessageEvent, state: WsState) {
    try {
        const msg = JSON.parse(event.data) as WSMessage;
        if (msg.type === 'init' && msg.data) { state.setGraphData(msg.data); state.setRepoLoading(false); }
        else if (msg.type === 'update' && msg.delta) {
            state.setGraphData(prev => mergeGraphData(prev, msg.delta));
            if (state.scanningRef.current) { state.analyzedRef.current += 1; state.setScanProgress({ analyzed: state.analyzedRef.current, total: msg.scanTotal ?? 0 }); }
        } else if (msg.type === 'scan_start') { state.scanningRef.current = true; state.analyzedRef.current = 0; state.setScanProgress({ analyzed: 0, total: msg.scanTotal ?? 0 }); }
        else if (msg.type === 'scan_complete') { state.scanningRef.current = false; state.setScanProgress(null); state.setScanning(false); state.setLastScan({ fileCount: msg.scanAnalyzed ?? state.analyzedRef.current, ts: Date.now() }); }
        else if (msg.type === 'repo_created') { state.onRepoCreatedRef.current?.(); }
    } catch { /* WebSocket message parse error — non-critical */ }
}

interface UseWebSocketConnectionReturn {
    graphData: GraphData; wsStatus: 'connecting' | 'connected' | 'disconnected';
    scanProgress: { analyzed: number; total: number } | null;
    scanningRef: React.MutableRefObject<boolean>; scanning: boolean;
    setScanning: React.Dispatch<React.SetStateAction<boolean>>;
    lastScan: { fileCount: number; ts: number } | null;
    setLastScan: React.Dispatch<React.SetStateAction<{ fileCount: number; ts: number } | null>>;
    handleScanAll: () => void; repoLoading: boolean;
}

export function useWebSocketConnection(selectedRepo: string | null, onRepoCreated?: () => void): UseWebSocketConnectionReturn {
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [scanProgress, setScanProgress] = useState<{ analyzed: number; total: number } | null>(null);
    const [repoLoading, setRepoLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [lastScan, setLastScan] = useState<{ fileCount: number; ts: number } | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scanningRef = useRef(false);
    const analyzedRef = useRef(0);
    const onRepoCreatedRef = useRef(onRepoCreated);
    onRepoCreatedRef.current = onRepoCreated;

    const connect = useCallback((repo: string | null) => {
        if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
        if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
        setRepoLoading(true);
        setGraphData({ nodes: [], edges: [] });
        const url = repo ? `ws://${window.location.host}?repo=${encodeURIComponent(repo)}` : `ws://${window.location.host}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => setWsStatus('connected');
        ws.onmessage = (event) => handleWsMessage(event, { setGraphData, setWsStatus, setScanProgress, setRepoLoading, setScanning, setLastScan, scanningRef, analyzedRef, onRepoCreatedRef, reconnect: connect });
        ws.onclose = () => { setWsStatus('disconnected'); reconnectTimer.current = setTimeout(() => connect(repo), 3000); };
        ws.onerror = () => ws.close();
    }, []);

    useEffect(() => { connect(selectedRepo); return () => { wsRef.current?.close(); if (reconnectTimer.current) clearTimeout(reconnectTimer.current); }; }, [selectedRepo, connect]);

    const handleScanAll = useCallback(async () => {
        if (scanningRef.current) return;
        scanningRef.current = true; setScanning(true);
        try { const res = await fetch('/api/scan', { method: 'POST' }); if (!res.ok) { scanningRef.current = false; setScanning(false); } }
        catch { scanningRef.current = false; setScanning(false); }
    }, []);

    return { graphData, wsStatus, scanProgress, scanningRef, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading };
}
