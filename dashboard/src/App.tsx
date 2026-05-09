import React from 'react';
import { AppHeader } from './components/AppHeader';
import { ScanProgressBar } from './components/HeaderWidgets';
import { AppContent, RepoOverlay } from './components/AppContent';
import { GraphErrorBoundary } from './components/ErrorBoundary';
import { useTheme } from './ThemeContext';
import { useRepoSelection, useNodeHandlers, useSearchUI, usePanelActions, useArchConfig, useGraphData, useAppMetrics } from './hooks';

export default function App() {
    const { T } = useTheme();
    const { repos, selectedRepo, showRepoSelector, setShowRepoSelector, handleRepoSelect, handleRepoDelete, refreshRepos } = useRepoSelection();
    const { graphData, filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns, wsStatus, scanProgress, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading } = useGraphData(selectedRepo, refreshRepos);
    const { selectedNode, handleClearSelection, handleNodeSelect } = useNodeHandlers(filteredGraphData);
    const { searchQuery, searchRef, searchResults, showSearchDropdown, handleSearchSelect, handleSearchChange, handleSearchFocus, handleSearchBlur, handleSearchKeyDown } = useSearchUI(filteredGraphData.nodes, handleNodeSelect);
    const { showFileList, showFilterPanel, showViolationsPanel, handleShowRepoSelector, handleFileListOpen, handleFileListSelect, handleFileListClose, handleToggleFilterPanel, handleCloseFilterPanel, handleToggleViolationsPanel, handleCloseViolationsPanel, handleClear } = usePanelActions(handleClearSelection, handleNodeSelect, setShowRepoSelector, filteredGraphData, setScanning, setLastScan, selectedRepo, repos);
    const archConfig = useArchConfig(selectedRepo);

    const { totalViolations, overallRating, currentRepoLabel, scanPct } = useAppMetrics(filteredGraphData, selectedRepo, repos, scanProgress);

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
            <GraphErrorBoundary fallbackData={filteredGraphData} onNodeSelect={handleNodeSelect} T={T}>
                <AppContent
                    repoLoading={repoLoading} scanning={scanning} filteredGraphData={filteredGraphData}
                    graphData={graphData} selectedNode={selectedNode} showFileList={showFileList}
                    showFilterPanel={showFilterPanel} showViolationsPanel={showViolationsPanel}
                    selectedRepo={selectedRepo} patterns={patterns} scanExcludePatterns={scanExcludePatterns}
                    archConfig={archConfig} wsStatus={wsStatus}
                    onNodeSelect={handleNodeSelect} onCanvasClick={handleClearSelection}
                    onFileListSelect={handleFileListSelect} onFileListClose={handleFileListClose}
                    onFilterClose={handleCloseFilterPanel} onViolationsClose={handleCloseViolationsPanel}
                    onAddPattern={addPattern} onRemovePattern={removePattern}
                    onScanAll={handleScanAll} T={T}
                />
            </GraphErrorBoundary>
            <RepoOverlay showRepoSelector={showRepoSelector} repos={repos} selectedRepo={selectedRepo} onSelect={handleRepoSelect} onClose={handleShowRepoSelector} onDelete={handleRepoDelete} />
        </div>
    );
}
