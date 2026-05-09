import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VisGraphView } from './VisGraphView';
import { DetailPanel } from './DetailPanel';
import { FileListDrawer } from './FileListDrawer';
import { ViolationsPanel } from './ViolationsPanel';
import { FilterPanel } from './FilterPanel';
import { RepoSelectorModal } from './RepoSelector';
import { GraphData, RepoInfo, ExcludePattern } from '../types';
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
    wsStatus: 'connecting' | 'connected' | 'disconnected';
    onNodeSelect: (node: GraphData['nodes'][number]) => void;
    onCanvasClick: () => void;
    onFileListSelect: (node: GraphData['nodes'][number]) => void;
    onFileListClose: () => void;
    onFilterClose: () => void;
    onViolationsClose: () => void;
    onAddPattern: (pattern: string, label?: string) => void;
    onRemovePattern: (id: number) => void;
    onScanAll: () => void;
    T: ThemeTokens;
}

export function AppContent({
    repoLoading, scanning, filteredGraphData, graphData, selectedNode,
    showFileList, showFilterPanel, showViolationsPanel, selectedRepo,
    patterns, scanExcludePatterns, wsStatus,
    onNodeSelect, onCanvasClick, onFileListSelect, onFileListClose,
    onFilterClose, onViolationsClose, onAddPattern, onRemovePattern,
    onScanAll, T,
}: AppContentProps) {
    const [panelWidth, setPanelWidth] = useState(400);
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isResizing) return;
        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;
            const container = containerRef.current;
            const containerRect = container.getBoundingClientRect();
            const newWidth = containerRect.right - e.clientX;
            if (newWidth >= 250 && newWidth <= 800) setPanelWidth(newWidth);
        };
        const handleMouseUp = () => setIsResizing(false);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const [dividerHover, setDividerHover] = useState(false);

    const handleDividerMouseDown = useCallback(() => setIsResizing(true), []);
    const handleDividerMouseEnter = useCallback(() => setDividerHover(true), []);
    const handleDividerMouseLeave = useCallback(() => setDividerHover(false), []);

    if (repoLoading) {
        return (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        width: 28, height: 28,
                        border: `2px solid ${T.border}`, borderTopColor: T.accent,
                        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                    }} />
                    <span style={{ fontSize: 13, color: T.textMuted }}>
                        Connecting to daemon on port 5378…
                    </span>
                </div>
            </div>
        );
    }

    if (wsStatus === 'disconnected') {
        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: T.bg, gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                    Daemon unreachable
                </div>
                <div style={{ fontSize: 13, color: T.textMuted, textAlign: 'center', maxWidth: 420 }}>
                    Cannot connect to the daemon on port 5378.
                    Run <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', background: T.panel, padding: '1px 5px', borderRadius: 3 }}>node dist/daemon.js</code> to start it.
                </div>
                <div style={{ fontSize: 12, color: T.textDim }}>
                    Retrying every 3 seconds.
                </div>
            </div>
        );
    }

    if (!selectedRepo) {
        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: T.bg, gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                    No repository selected
                </div>
                <div style={{ fontSize: 13, color: T.textMuted }}>
                    Pick one from the dropdown in the header.
                </div>
            </div>
        );
    }

    if (wsStatus === 'connected' && filteredGraphData.nodes.length === 0 && !scanning) {
        return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: T.bg, gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
                    No files analyzed yet
                </div>
                <div style={{ fontSize: 13, color: T.textMuted, textAlign: 'center', maxWidth: 420 }}>
                    Run a scan to analyze code quality across all files in this repository.
                </div>
                <button
                    onClick={onScanAll}
                    style={{
                        background: 'transparent', border: `1px solid ${T.border}`,
                        borderRadius: 4, color: T.text, cursor: 'pointer',
                        fontSize: 12, fontWeight: 500, padding: '6px 14px',
                        marginTop: 4,
                    }}
                >
                    Scan all files
                </button>
            </div>
        );
    }

    return (
        <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
            <VisGraphView
                graphData={filteredGraphData}
                onNodeClick={onNodeSelect}
                onCanvasClick={onCanvasClick}
                highlightNodeId={selectedNode?.id}
                selectedRepo={selectedRepo}
                focusNodeId={selectedNode?.id}
                scanning={scanning}
            />
            {selectedNode && !showFilterPanel && (
                <DetailPanel node={selectedNode} graphData={filteredGraphData} onClose={onCanvasClick} onNodeSelect={onNodeSelect} selectedRepo={selectedRepo} />
            )}
            {(
                <div
                    onMouseDown={handleDividerMouseDown}
                    onMouseEnter={handleDividerMouseEnter}
                    onMouseLeave={handleDividerMouseLeave}
                    style={{
                        width: 8, paddingLeft: 2, paddingRight: 2,
                        cursor: 'col-resize',
                        background: isResizing || dividerHover ? T.accent : 'transparent',
                        transition: isResizing ? 'none' : 'background 0.2s ease',
                        userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderLeft: `1px solid ${isResizing || dividerHover ? T.accent : T.border}`,
                        borderRight: `1px solid ${isResizing || dividerHover ? T.accent : T.border}`,
                    }}
                    title="Drag to resize right panel"
                />
            )}
            {showFileList && (
                <FileListDrawer graphData={filteredGraphData} onNodeSelect={onFileListSelect} onClose={onFileListClose} width={panelWidth} />
            )}
            {showFilterPanel && selectedRepo && (
                <FilterPanel patterns={patterns} onAdd={onAddPattern} onRemove={onRemovePattern} onClose={onFilterClose}
                    excludedCount={graphData.nodes.length - filteredGraphData.nodes.length}
                    totalCount={graphData.nodes.length} scanExcludePatterns={scanExcludePatterns} />
            )}
            {showViolationsPanel && (
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
    onDelete: (repoRoot: string) => void;
}

export function RepoOverlay({ showRepoSelector, repos, selectedRepo, onSelect, onClose, onDelete }: RepoOverlayProps) {
    if (!showRepoSelector) return null;
    return <RepoSelectorModal repos={repos} selectedRepo={selectedRepo} onSelect={onSelect} onClose={onClose} onDelete={onDelete} />;
}