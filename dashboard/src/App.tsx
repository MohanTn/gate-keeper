import React, { useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { ScanProgressBar } from './components/HeaderWidgets';
import { AppContent, RepoOverlay } from './components/AppContent';
import { QualityDashboard } from './components/QualityDashboard';
import { GraphErrorBoundary } from './components/ErrorBoundary';
import { useTheme } from './ThemeContext';
import { useRepoSelection, useNodeHandlers, useSearchUI, usePanelActions, useGraphData, useAppMetrics } from './hooks';

export default function App() {
    const { T } = useTheme();
    const [view, setView] = useState<'graph' | 'quality'>('graph');
    const [qualityLoopRunning, setQualityLoopRunning] = useState(false);
    const { repos, selectedRepo, showRepoSelector, setShowRepoSelector, handleRepoSelect, handleRepoDelete, refreshRepos } = useRepoSelection();
    const { graphData, filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns, wsStatus, scanProgress, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading } = useGraphData(selectedRepo, refreshRepos);
    const { selectedNode, handleClearSelection, handleNodeSelect } = useNodeHandlers(filteredGraphData);
    const { searchQuery, searchRef, searchResults, showSearchDropdown, handleSearchSelect, handleSearchChange, handleSearchFocus, handleSearchBlur, handleSearchKeyDown } = useSearchUI(filteredGraphData.nodes, handleNodeSelect);
    const { showFileList, showFilterPanel, showViolationsPanel, handleShowRepoSelector, handleFileListOpen, handleFileListSelect, handleFileListClose, handleToggleFilterPanel, handleCloseFilterPanel, handleToggleViolationsPanel, handleCloseViolationsPanel, handleClear } = usePanelActions(handleClearSelection, handleNodeSelect, setShowRepoSelector, filteredGraphData, setScanning, setLastScan, selectedRepo, repos);

    const { totalViolations, overallRating, currentRepoLabel, scanPct } = useAppMetrics(filteredGraphData, selectedRepo, repos, scanProgress);

    const handleStartQualityLoop = async () => {
        try {
            // 1. Set config: threshold 8.0, 1 worker
            await fetch('http://127.0.0.1:5379/api/quality/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ threshold: 8.0, maxWorkers: 1 }),
            });
            // 2. Reset any previously failed items
            await fetch('http://127.0.0.1:5379/api/quality/reset', { method: 'POST' });
            // 3. Enqueue files below new threshold
            await fetch('http://127.0.0.1:5379/api/quality/enqueue', { method: 'POST' });
            // 4. Start the loop
            await fetch('http://127.0.0.1:5379/api/quality/start', { method: 'POST' });
            setQualityLoopRunning(true);
            // 5. Switch to quality loop view
            setView('quality');
        } catch {
            // Daemon not running or quality loop not available
            setQualityLoopRunning(false);
        }
    };

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
                onStartQualityLoop={handleStartQualityLoop} qualityLoopRunning={qualityLoopRunning}
            />
            {/* View switcher tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, background: T.panel, padding: '0 16px' }}>
                <TabButton label="Graph View" active={view === 'graph'} onClick={() => setView('graph')} T={T} />
                <TabButton label="Quality Loop" active={view === 'quality'} onClick={() => setView('quality')} T={T} />
            </div>
            {view === 'graph' ? (
                <GraphErrorBoundary fallbackData={filteredGraphData} onNodeSelect={handleNodeSelect} T={T}>
                    <AppContent
                        repoLoading={repoLoading} scanning={scanning} filteredGraphData={filteredGraphData}
                        graphData={graphData} selectedNode={selectedNode} showFileList={showFileList}
                        showFilterPanel={showFilterPanel} showViolationsPanel={showViolationsPanel}
                        selectedRepo={selectedRepo} patterns={patterns} scanExcludePatterns={scanExcludePatterns}
                        wsStatus={wsStatus}
                        onNodeSelect={handleNodeSelect} onCanvasClick={handleClearSelection}
                        onFileListSelect={handleFileListSelect} onFileListClose={handleFileListClose}
                        onFilterClose={handleCloseFilterPanel} onViolationsClose={handleCloseViolationsPanel}
                        onAddPattern={addPattern} onRemovePattern={removePattern}
                        onScanAll={handleScanAll} T={T}
                    />
                </GraphErrorBoundary>
            ) : (
                <QualityDashboard T={T} />
            )}
            <RepoOverlay showRepoSelector={showRepoSelector} repos={repos} selectedRepo={selectedRepo} onSelect={handleRepoSelect} onClose={handleShowRepoSelector} onDelete={handleRepoDelete} />
        </div>
    );
}

function TabButton({ label, active, onClick, T }: { label: string; active: boolean; onClick: () => void; T: any }) {
    return (
        <button
            onClick={onClick}
            style={{
                background: 'transparent', border: 'none', borderBottom: active ? `2px solid ${T.accent}` : '2px solid transparent',
                color: active ? T.text : T.textMuted, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                padding: '8px 16px', marginBottom: -1,
            }}
        >
            {label}
        </button>
    );
}
