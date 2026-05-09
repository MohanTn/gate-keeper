import React from 'react';
import { GraphData, RepoInfo, GraphNode } from '../types';
import { HeaderStat, HeaderButton, ScanProgressIndicator } from './HeaderWidgets';
import { SearchResultItem } from './RepoSelector';
import { ratingColor, ThemeTokens, useTheme } from '../ThemeContext';

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
    const config: Record<string, { color: string; label: string }> = {
        connecting: { color: T.yellow, label: 'Connecting' },
        connected: { color: T.green, label: 'Connected' },
        disconnected: { color: T.red, label: 'Offline' },
    };
    const { color, label } = config[status] ?? config.disconnected;
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 11, color: T.textMuted, flexShrink: 0,
        }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
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
    const { mode, toggleTheme } = useTheme();
    return (
        <header style={{
            height: 48, minHeight: 48, background: T.panel,
            borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14,
            zIndex: 30, flexShrink: 0,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
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
                    }}>
                        {searchResults.map(node => (
                            <SearchResultItem key={node.id} node={node} onSelect={onSearchSelect} />
                        ))}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                {overallRating != null && (
                    <HeaderStat label="Score" value={`${overallRating.toFixed(1)}`} color={ratingColor(overallRating, T)} bold />
                )}
                <HeaderStat label="Issues" value={totalViolations} color={totalViolations > 0 ? T.red : T.green} onClick={onToggleViolationsPanel} />
            </div>

            <div style={{ flex: 1 }} />

            <HeaderButton label={`Filters${patterns.length > 0 ? ` (${patterns.length})` : ''}`} onClick={onToggleFilterPanel} disabled={!selectedRepo} />
            <HeaderButton label={`Files (${filteredGraphData.nodes.length})`} onClick={onFileListOpen} disabled={filteredGraphData.nodes.length === 0} />
            {scanning ? (
                <ScanProgressIndicator analyzed={scanProgress?.analyzed ?? 0} total={scanProgress?.total ?? 0} />
            ) : (
                <HeaderButton label="Scan all" onClick={onScanAll} disabled={wsStatus !== 'connected'} primary />
            )}
            <HeaderButton label="Clear" onClick={onClearData} disabled={!selectedRepo || wsStatus !== 'connected'} danger />

            <button
                onClick={toggleTheme}
                title="Toggle theme"
                style={{
                    height: 26, padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 4,
                    color: T.textMuted, cursor: 'pointer', fontSize: 11, fontWeight: 500, flexShrink: 0,
                }}
            >
                {mode === 'light' ? 'Light' : 'Dark'}
            </button>
        </header>
    );
}
