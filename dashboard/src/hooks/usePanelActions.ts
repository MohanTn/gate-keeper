import { useCallback, useEffect, useState } from 'react';
import { GraphData, GraphNode, RepoInfo } from '../types';
import { useClearData } from './useClearData';

interface UsePanelActionsReturn {
    showFileList: boolean;
    showFilterPanel: boolean;
    showViolationsPanel: boolean;
    handleShowRepoSelector: () => void;
    handleFileListOpen: () => void;
    handleFileListSelect: (node: GraphNode) => void;
    handleFileListClose: () => void;
    handleToggleFilterPanel: () => void;
    handleCloseFilterPanel: () => void;
    handleToggleViolationsPanel: () => void;
    handleCloseViolationsPanel: () => void;
    handleClear: () => Promise<void>;
}

export function usePanelActions(
    handleClearSelection: () => void,
    handleNodeSelect: (node: GraphNode) => void,
    setShowRepoSelector: React.Dispatch<React.SetStateAction<boolean>>,
    filteredGraphData: GraphData,
    setScanning: React.Dispatch<React.SetStateAction<boolean>>,
    setLastScan: React.Dispatch<React.SetStateAction<{ fileCount: number; ts: number } | null>>,
    selectedRepo: string | null,
    repos: RepoInfo[],
): UsePanelActionsReturn {
    const handleClear = useClearData(selectedRepo, repos);
    const [showFileList, setShowFileList] = useState(false);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showViolationsPanel, setShowViolationsPanel] = useState(false);

    useEffect(() => {
        setLastScan({ fileCount: filteredGraphData.nodes.length, ts: Date.now() });
    }, [filteredGraphData.nodes.length, setLastScan]);

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
        handleToggleViolationsPanel, handleCloseViolationsPanel, handleClear,
    };
}
