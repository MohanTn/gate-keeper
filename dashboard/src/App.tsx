import React, { useState, useEffect } from 'react';
import { VisGraphView } from './components/VisGraphView';
import { AppHeader } from './components/AppHeader';
import { ScanProgressBar } from './components/HeaderWidgets';
import { AppContent, RepoOverlay } from './components/AppContent';
import { useTheme } from './ThemeContext';
import { useWebSocketConnection, useRepoSelection, useNodeHandlers, useExcludePatterns, useSearchUI, usePanelActions } from './hooks';
import type { RepoInfo, ArchMapping } from './types';

async function handleClearData(selectedRepo: string | null, repos: RepoInfo[]) {
    if (!selectedRepo) { alert('Please select a repository first'); return; }
    const repoLabel = repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop();
    if (!window.confirm(`Delete all analysis data for "${repoLabel}"? This cannot be undone.`)) return;
    try {
        const res = await fetch('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: selectedRepo }) });
        if (res.ok) { const data = await res.json(); alert(`Deleted ${data.deleted} analyses.`); window.location.reload(); }
        else { alert('Error clearing data'); }
    } catch { alert('Error clearing data'); }
}

export default function App() {
    const { T } = useTheme();
    const [archConfig, setArchConfig] = useState<ArchMapping | null>(null);
    const { repos, selectedRepo, showRepoSelector, setShowRepoSelector, handleRepoSelect, refreshRepos } = useRepoSelection();
    const { graphData, wsStatus, scanProgress, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading } = useWebSocketConnection(selectedRepo, refreshRepos);
    const { filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns } = useExcludePatterns(selectedRepo, graphData);
    const { selectedNode, handleClearSelection, handleNodeSelect } = useNodeHandlers(filteredGraphData);
    const { searchQuery, searchRef, searchResults, showSearchDropdown, handleSearchSelect, handleSearchChange, handleSearchFocus, handleSearchBlur, handleSearchKeyDown } = useSearchUI(filteredGraphData.nodes, handleNodeSelect);
    const { showFileList, showFilterPanel, showViolationsPanel, handleShowRepoSelector, handleFileListOpen, handleFileListSelect, handleFileListClose, handleToggleFilterPanel, handleCloseFilterPanel, handleToggleViolationsPanel, handleCloseViolationsPanel } = usePanelActions(handleClearSelection, handleNodeSelect, setShowRepoSelector, filteredGraphData, setScanning, setLastScan);

    // Fetch arch config when repo changes
    useEffect(() => {
        if (!selectedRepo) {
            setArchConfig(null);
            return;
        }
        fetch(`/api/arch?repo=${encodeURIComponent(selectedRepo)}`)
            .then(r => r.json())
            .then(config => setArchConfig(config))
            .catch(err => {
                console.error('Failed to fetch arch config:', err);
                setArchConfig(null);
            });
    }, [selectedRepo]);

    const totalViolations = filteredGraphData.nodes.reduce((a, n) => a + n.violations.length, 0);
    const overallRating = graphData.nodes.length > 0 ? Math.round((graphData.nodes.reduce((a, n) => a + n.rating, 0) / graphData.nodes.length) * 10) / 10 : null;
    const currentRepoLabel = selectedRepo ? (repos.find(r => r.repoRoot === selectedRepo)?.label ?? selectedRepo.split('/').pop()) : null;
    const scanPct = scanProgress && scanProgress.total > 0 ? Math.round((scanProgress.analyzed / scanProgress.total) * 100) : null;

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
                onClearData={() => handleClearData(selectedRepo, repos)}
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
