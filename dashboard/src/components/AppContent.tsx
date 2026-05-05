import React from 'react';
import { VisGraphView } from './VisGraphView';
import { DetailPanel } from './DetailPanel';
import { FileListDrawer } from './FileListDrawer';
import { ViolationsPanel } from './ViolationsPanel';
import { FilterPanel } from './FilterPanel';
import { RepoLoadingOverlay } from './HeaderWidgets';
import { RepoSelectorModal } from './RepoSelector';
import { GraphData, RepoInfo, ExcludePattern } from '../types';

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
    onNodeSelect: (node: GraphData['nodes'][number]) => void;
    onCanvasClick: () => void;
    onFileListSelect: (node: GraphData['nodes'][number]) => void;
    onFileListClose: () => void;
    onFilterClose: () => void;
    onViolationsClose: () => void;
    onAddPattern: (pattern: string, label?: string) => void;
    onRemovePattern: (id: number) => void;
    T: Record<string, string>;
}

export function AppContent({
    repoLoading, scanning, filteredGraphData, graphData, selectedNode,
    showFileList, showFilterPanel, showViolationsPanel, selectedRepo,
    patterns, scanExcludePatterns,
    onNodeSelect, onCanvasClick, onFileListSelect, onFileListClose,
    onFilterClose, onViolationsClose, onAddPattern, onRemovePattern, T,
}: AppContentProps) {
    return (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
            {repoLoading ? <RepoLoadingOverlay /> : (
                <VisGraphView graphData={filteredGraphData} onNodeClick={onNodeSelect} onCanvasClick={onCanvasClick} highlightNodeId={selectedNode?.id} selectedRepo={selectedRepo} focusNodeId={selectedNode?.id} scanning={scanning} />
            )}
            {!repoLoading && selectedNode && !showFileList && !showFilterPanel && (
                <DetailPanel node={selectedNode} graphData={filteredGraphData} onClose={onCanvasClick} onNodeSelect={onNodeSelect} selectedRepo={selectedRepo} />
            )}
            {!repoLoading && showFileList && (
                <FileListDrawer graphData={filteredGraphData} onNodeSelect={onFileListSelect} onClose={onFileListClose} />
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
