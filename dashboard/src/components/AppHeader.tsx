import React from 'react';
import { GraphData, RepoInfo, GraphNode } from '../types';
import { HeaderStat, HeaderButton, ScanProgressIndicator } from './HeaderWidgets';
import { SearchResultItem } from './RepoSelector';
import { ratingColor, ThemeTokens } from '../ThemeContext';

interface AppHeaderProps {
    repos: RepoInfo[];
    selectedRepo: string | null;
    currentRepoLabel: string | null;
    wsStatus: 'connecting' | 'connected' | 'disconnected';
    scanning: boolean;
    scanProgress: { analyzed: number; total: number } | null;
    scanPct: number | null;
    filteredGraphData: GraphData;
    graphData: GraphData;
    patterns: { length: number };
    totalViolations: number;
    overallRating: number | null;
    searchQuery: string;
    searchRef: React.RefObject<HTMLInputElement>;
    searchResults: GraphNode[];
    showSearchDropdown: boolean;
    repoLoading: boolean;
    onShowRepoSelector: () => void;
    onToggleFilterPanel: () => void;
    onFileListOpen: () => void;
    onScanAll: () => void;
    onClearData: () => void;
    onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSearchFocus: () => void;
    onSearchBlur: () => void;
    onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onSearchSelect: (node: GraphNode) => void;
    onToggleViolationsPanel: () => void;
    T: ThemeTokens;
}

function WsStatusBadge({ status, T }: { status: string; T: ThemeTokens }) {
    const config: Record<string, { color: string; bg: string; label: string }> = {
        connecting: { color: '#EAB308', bg: 'rgba(234,179,8,0.1)', label: 'Connecting' },
        connected: { color: '#22C55E', bg: 'rgba(34,197,94,0.1)', label: 'Live' },
        disconnected: { color: '#EF4444', bg: 'rgba(239,68,68,0.1)', label: 'Offline' },
    };
    const { color, bg, label } = config[status] ?? config.disconnected;
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: bg, border: `1px solid ${color}40`, borderRadius: 4,
            padding: '1px 8px', fontSize: 10, fontWeight: 600, color,
            textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0,
        }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {label}
        </div>
    );
}

export function AppHeader({
    repos, selectedRepo, currentRepoLabel, wsStatus, scanning, scanProgress,
    filteredGraphData, graphData, patterns, totalViolations, overallRating,
    searchQuery, searchRef, searchResults, showSearchDropdown,
    onShowRepoSelector, onToggleFilterPanel, onFileListOpen, onScanAll, onClearData,
    onSearchChange, onSearchFocus, onSearchBlur, onSearchKeyDown, onSearchSelect,
    onToggleViolationsPanel, T,
}: AppHeaderProps) {
    return (
        <header style={{
            height: 48, minHeight: 48, background: T.panel,
            borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14,
            zIndex: 30, flexShrink: 0,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>
                    Gate Keeper
                </span>
                <WsStatusBadge status={wsStatus} T={T} />
            </div>

            <div style={{ width: 1, height: 20, background: T.border, flexShrink: 0 }} />

            <button
                onClick={onShowRepoSelector}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'transparent', border: `1px solid ${T.border}`,
                    borderRadius: 6, color: currentRepoLabel ? T.textMuted : T.textDim,
                    cursor: 'pointer', fontSize: 12, padding: '4px 12px',
                    maxWidth: 200, overflow: 'hidden', flexShrink: 0,
                }}
            >
                <span style={{ fontSize: 11 }}>▾</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentRepoLabel ?? 'Select repo'}
                </span>
            </button>

            <div style={{ width: 1, height: 20, background: T.border, flexShrink: 0 }} />

            <div style={{ position: 'relative', flex: '0 1 240px', minWidth: 140 }}>
                <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={onSearchChange}
                    onFocus={onSearchFocus}
                    onBlur={onSearchBlur}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search files…"
                    style={{
                        width: '100%', padding: '5px 10px',
                        background: T.bg, border: `1px solid ${T.border}`,
                        borderRadius: 6, color: T.text, fontSize: 12, outline: 'none',
                    }}
                />
                {showSearchDropdown && (
                    <div className="fade-in" style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                        background: T.panel, border: `1px solid ${T.borderBright}`,
                        borderRadius: 8, overflow: 'hidden', zIndex: 50,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    }}>
                        {searchResults.map(node => (
                            <SearchResultItem key={node.id} node={node} onSelect={onSearchSelect} />
                        ))}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <HeaderStat label="Files" value={filteredGraphData.nodes.length} color={T.textMuted} />
                {overallRating != null && (
                    <HeaderStat label="Score" value={`${overallRating.toFixed(1)}`} color={ratingColor(overallRating, T)} bold />
                )}
                <HeaderStat label="Issues" value={totalViolations} color={totalViolations > 0 ? T.red : T.green} onClick={onToggleViolationsPanel} />
                {patterns.length > 0 && (
                    <HeaderStat label="Hidden" value={graphData.nodes.length - filteredGraphData.nodes.length} color={T.textDim} />
                )}
            </div>

            <div style={{ flex: 1 }} />

            <HeaderButton label={`Filters${patterns.length > 0 ? ` (${patterns.length})` : ''}`} onClick={onToggleFilterPanel} disabled={!selectedRepo} />
            <HeaderButton label="Files" onClick={onFileListOpen} disabled={filteredGraphData.nodes.length === 0} />
            {scanning ? (
                <ScanProgressIndicator analyzed={scanProgress?.analyzed ?? 0} total={scanProgress?.total ?? 0} />
            ) : (
                <HeaderButton label="⟳ Scan All" onClick={onScanAll} disabled={wsStatus !== 'connected'} primary />
            )}
            <HeaderButton label="Clear" onClick={onClearData} disabled={!selectedRepo || wsStatus !== 'connected'} danger />

            <button
                onClick={() => {
                    const theme = document.documentElement.getAttribute('data-theme');
                    const next = theme === 'light' ? 'dark' : 'light';
                    document.documentElement.setAttribute('data-theme', next);
                    try { localStorage.setItem('gk-theme', next); } catch { }
                    window.location.reload();
                }}
                title="Toggle theme"
                style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 6,
                    color: T.textMuted, cursor: 'pointer', fontSize: 14, flexShrink: 0,
                }}
            >
                {document.documentElement.getAttribute('data-theme') === 'light' ? '☀' : '☾'}
            </button>
        </header>
    );
}
