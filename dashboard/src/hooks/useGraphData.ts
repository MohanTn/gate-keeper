import { useWebSocketConnection } from './useWebSocketConnection';
import { useExcludePatterns } from './useExcludePatterns';

export function useGraphData(selectedRepo: string | null, onRepoCreated?: () => void) {
    const ws = useWebSocketConnection(selectedRepo, onRepoCreated);
    const filtered = useExcludePatterns(selectedRepo, ws.graphData);

    return {
        graphData: ws.graphData,
        filteredGraphData: filtered.filteredGraphData,
        patterns: filtered.patterns,
        addPattern: filtered.addPattern,
        removePattern: filtered.removePattern,
        scanExcludePatterns: filtered.scanExcludePatterns,
        wsStatus: ws.wsStatus,
        scanProgress: ws.scanProgress,
        scanning: ws.scanning,
        setScanning: ws.setScanning,
        lastScan: ws.lastScan,
        setLastScan: ws.setLastScan,
        handleScanAll: ws.handleScanAll,
        repoLoading: ws.repoLoading,
    };
}
