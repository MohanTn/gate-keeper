import React, { useState, useRef, useEffect } from 'react';
import { VisGraphView } from './VisGraphView';
import { DetailPanel } from './DetailPanel';
import { FileListDrawer } from './FileListDrawer';
import { ViolationsPanel } from './ViolationsPanel';
import { FilterPanel } from './FilterPanel';
import { RepoLoadingOverlay } from './HeaderWidgets';
import { RepoSelectorModal } from './RepoSelector';
import { GraphData, RepoInfo, ExcludePattern, ArchMapping } from '../types';
import { ThemeTokens } from '../ThemeContext';

interface ScanExcludePatterns {
    global: string[];
    csharp: string[];
    typescript: string[];
}

interface AppContentProps {
    repoLoading: boolean;
    scanning: boolean;
    filteredGraphData: GraphData;
    graphData: GraphData;
    selectedNode: GraphData['nodes'][number] | null;
    showFileList: boolean;
    showFilterPanel: boolean;
    showViolationsPanel: boolean;
    selectedRepo: string | null;
    patterns: ExcludePattern[];
    scanExcludePatterns: ScanExcludePatterns | null;
    archConfig?: ArchMapping | null;
    onNodeSelect: (node: GraphData['nodes'][number]) => void;
    onCanvasClick: () => void;
    onFileListSelect: (node: GraphData['nodes'][number]) => void;
    onFileListClose: () => void;
    onFilterClose: () => void;
    onViolationsClose: () => void;
    onAddPattern: (pattern: string, label?: string) => void;
    onRemovePattern: (id: number) => void;
    T: ThemeTokens;
}

export function AppContent({
    repoLoading, scanning, filteredGraphData, graphData, selectedNode,
    showFileList, showFilterPanel, showViolationsPanel, selectedRepo,
    patterns, scanExcludePatterns, archConfig,
    onNodeSelect, onCanvasClick, onFileListSelect, onFileListClose,
    onFilterClose, onViolationsClose, onAddPattern, onRemovePattern, T,
}: AppContentProps) {
    const [panelWidth, setPanelWidth] = useState(400);
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Handle mouse move for resizing
    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;
            const container = containerRef.current;
            const containerRect = container.getBoundingClientRect();
            const newWidth = containerRect.right - e.clientX;
            
            // Constrain panel width between 250px and 800px
            if (newWidth >= 250 && newWidth <= 800) {
                setPanelWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const [dividerHover, setDividerHover] = useState(false);

    return (
        <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
            {repoLoading ? <RepoLoadingOverlay /> : (
                <VisGraphView graphData={filteredGraphData} onNodeClick={onNodeSelect} onCanvasClick={onCanvasClick} highlightNodeId={selectedNode?.id} selectedRepo={selectedRepo} focusNodeId={selectedNode?.id} scanning={scanning} archConfig={archConfig} />
            )}
            {!repoLoading && selectedNode && !showFilterPanel && (
                <DetailPanel node={selectedNode} graphData={filteredGraphData} onClose={onCanvasClick} onNodeSelect={onNodeSelect} selectedRepo={selectedRepo} />
            )}
            {/* Resizable divider */}
            {!repoLoading && (
                <div
                    onMouseDown={() => setIsResizing(true)}
                    onMouseEnter={() => setDividerHover(true)}
                    onMouseLeave={() => setDividerHover(false)}
                    style={{
                        width: 8,
                        paddingLeft: 2,
                        paddingRight: 2,
                        cursor: 'col-resize',
                        background: isResizing || dividerHover ? T.accent : 'transparent',
                        transition: isResizing ? 'none' : `background 0.2s ease`,
                        userSelect: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderLeft: `1px solid ${isResizing || dividerHover ? T.accent : T.border}`,
                        borderRight: `1px solid ${isResizing || dividerHover ? T.accent : T.border}`,
                    }}
                    title="Drag to resize right panel"
                />
            )}
            {!repoLoading && (
                <FileListDrawer graphData={filteredGraphData} onNodeSelect={onFileListSelect} onClose={onFileListClose} width={panelWidth} />
            )}
            {!repoLoading && showFilterPanel && selectedRepo && (
                <FilterPanel patterns={patterns} onAdd={onAddPattern} onRemove={onRemovePattern} onClose={onFilterClose} excludedCount={graphData.nodes.length - filteredGraphData.nodes.length} totalCount={graphData.nodes.length} scanExcludePatterns={scanExcludePatterns} />
            )}
            {!repoLoading && showViolationsPanel && (
                <ViolationsPanel graphData={filteredGraphData} onClose={onViolationsClose} T={T} />
            )}
        </div>
    );
}

interface RepoOverlayProps {
    showRepoSelector: boolean;
    repos: RepoInfo[];
    selectedRepo: string | null;
    onSelect: (repo: string) => void;
    onClose: () => void;
}

export function RepoOverlay({ showRepoSelector, repos, selectedRepo, onSelect, onClose }: RepoOverlayProps) {
    if (!showRepoSelector) return null;
    return <RepoSelectorModal repos={repos} selectedRepo={selectedRepo} onSelect={onSelect} onClose={onClose} />;
}
