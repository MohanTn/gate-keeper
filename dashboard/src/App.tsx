import React, { useMemo } from 'react';
import { AppHeader } from './components/AppHeader';
import { ScanProgressBar } from './components/HeaderWidgets';
import { AppContent, RepoOverlay } from './components/AppContent';
import { useTheme } from './ThemeContext';
import { useRepoSelection, useNodeHandlers, useSearchUI, usePanelActions, useArchConfig, useGraphData } from './hooks';

export default function App() {
    const { T } = useTheme();
    const { repos, selectedRepo, showRepoSelector, setShowRepoSelector, handleRepoSelect, refreshRepos } = useRepoSelection();
    const { graphData, filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns, wsStatus, scanProgress, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading } = useGraphData(selectedRepo, refreshRepos);
    const { selectedNode, handleClearSelection, handleNodeSelect } = useNodeHandlers(filteredGraphData);
    const { searchQuery, searchRef, searchResults, showSearchDropdown, handleSearchSelect, handleSearchChange, handleSearchFocus, handleSearchBlur, handleSearchKeyDown } = useSearchUI(filteredGraphData.nodes, handleNodeSelect);
    const { showFileList, showFilterPanel, showViolationsPanel, handleShowRepoSelector, handleFileListOpen, handleFileListSelect, handleFileListClose, handleToggleFilterPanel, handleCloseFilterPanel, handleToggleViolationsPanel, handleCloseViolationsPanel, handleClear } = usePanelActions(handleClearSelection, handleNodeSelect, setShowRepoSelector, filteredGraphData, setScanning, setLastScan, selectedRepo, repos);
    const archConfig = useArchConfig(selectedRepo);

    const totalViolations = useMemo(
        () => filteredGraphData.nodes.reduce((a, n) => a + n.violations.length, 0),
        [filteredGraphData.nodes]
    );
    const overallRating = useMemo(() => {
        const locTotal = filteredGraphData.nodes.reduce((a, n) => a + (n.metrics.linesOfCode || 1), 0);
        return filteredGraphData.nodes.length > 0 && locTotal > 0
            ? Math.round((filteredGraphData.nodes.reduce((a, n) => a + n.rating * (n.metrics.linesOfCode || 1), 0) / locTotal) * 10) / 10
            : null;
    }, [filteredGraphData.nodes]);
    const currentRepoLabel = useMemo(
        () => selectedRepo ? (repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop()) : null,
        [selectedRepo, repos]
    );
    const scanPct = useMemo(
        () => scanProgress && scanProgress.total > 0 ? Math.round((scanProgress.analyzed / scanProgress.total) * 100) : null,
        [scanProgress]
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: T.bg, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' }}>
            <ScanProgressBar scanning={scanning} scanPct={scanPct} T={T} />
            <AppHeader
                repos={repos} selectedRepo={selectedRepo} currentRepoLabel={currentRepoLabel}
                wsStatus={wsStatus} scanning={scanning} scanProgress={scanProgress} scanPct={scanPct}
                filteredGraphData={filteredGraphData} graphData={graphData} patterns={patterns}
                totalViolations={totalViolations} overallRating={overallRating}
                searchQuery={searchQuery} searchRef={searchRef} searchResults={searchResults}
                showSearchDropdown={showSearchDropdown} repoLoading={repoLoading} T={T}
                onShowRepoSelector={handleShowRepoSelector} onToggleFilterPanel={handleToggleFilterPanel}
                onFileListOpen={handleFileListOpen} onScanAll={handleScanAll}
                onClearData={handleClear}
                onSearchChange={handleSearchChange} onSearchFocus={handleSearchFocus}
                onSearchBlur={handleSearchBlur} onSearchKeyDown={handleSearchKeyDown}
                onSearchSelect={handleSearchSelect} onToggleViolationsPanel={handleToggleViolationsPanel}
            />
            <AppContent
                repoLoading={repoLoading} scanning={scanning} filteredGraphData={filteredGraphData}
                graphData={graphData} selectedNode={selectedNode} showFileList={showFileList}
                showFilterPanel={showFilterPanel} showViolationsPanel={showViolationsPanel}
                selectedRepo={selectedRepo} patterns={patterns} scanExcludePatterns={scanExcludePatterns}
                archConfig={archConfig}
                onNodeSelect={handleNodeSelect} onCanvasClick={handleClearSelection}
                onFileListSelect={handleFileListSelect} onFileListClose={handleFileListClose}
                onFilterClose={handleCloseFilterPanel} onViolationsClose={handleCloseViolationsPanel}
                onAddPattern={addPattern} onRemovePattern={removePattern} T={T}
            />
            <RepoOverlay showRepoSelector={showRepoSelector} repos={repos} selectedRepo={selectedRepo} onSelect={handleRepoSelect} onClose={handleShowRepoSelector} />
        </div>
    );
}
