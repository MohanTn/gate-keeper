import React from 'react';
import { AppHeader } from './components/AppHeader';
import { ScanProgressBar } from './components/HeaderWidgets';
import { ThemeTokens } from './ThemeContext';
import { AppContent, RepoOverlay } from './components/AppContent';
import { QualityDashboard } from './components/QualityDashboard';
import { GraphErrorBoundary } from './components/ErrorBoundary';
import { useTheme } from './ThemeContext';
import { useAppState } from './hooks/useAppState';

export default function App() {
    const { T } = useTheme();
    const {
        view, setView, repos, selectedRepo, showRepoSelector, setShowRepoSelector,
        handleRepoSelect, handleRepoDelete, refreshRepos,
        graphData, filteredGraphData, patterns, addPattern, removePattern, scanExcludePatterns,
        wsStatus, scanProgress, scanning, setScanning, lastScan, setLastScan, handleScanAll, repoLoading,
        selectedNode, handleClearSelection, handleNodeSelect,
        searchQuery, searchRef, searchResults, showSearchDropdown,
        handleSearchSelect, handleSearchChange, handleSearchFocus, handleSearchBlur, handleSearchKeyDown,
        showFileList, showFilterPanel, showViolationsPanel,
        handleShowRepoSelector, handleFileListOpen, handleFileListSelect, handleFileListClose,
        handleToggleFilterPanel, handleCloseFilterPanel, handleToggleViolationsPanel, handleCloseViolationsPanel,
        handleClear, totalViolations, overallRating, currentRepoLabel, scanPct,
    } = useAppState();

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

function TabButton({ label, active, onClick, T }: { label: string; active: boolean; onClick: () => void; T: ThemeTokens }) {
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
