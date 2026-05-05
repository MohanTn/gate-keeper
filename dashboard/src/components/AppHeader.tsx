import React from 'react';
import { GraphData, RepoInfo } from '../types';
import { Divider, ThemeToggleButton, HeaderStat, HeaderButton, ScanProgressIndicator } from './HeaderWidgets';
import { SearchResultItem } from './RepoSelector';
import { ratingColor } from '../ThemeContext';

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
    searchResults: typeof filteredGraphData.nodes;
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
    onSearchSelect: (node: typeof filteredGraphData.nodes[number]) => void;
    onToggleViolationsPanel: () => void;
    T: Record<string, string>;
}

export function AppHeader({
    repos, selectedRepo, currentRepoLabel, wsStatus, scanning, scanProgress, scanPct,
    filteredGraphData, graphData, patterns, totalViolations, overallRating,
    searchQuery, searchRef, searchResults, showSearchDropdown,
    onShowRepoSelector, onToggleFilterPanel, onFileListOpen, onScanAll, onClearData,
    onSearchChange, onSearchFocus, onSearchBlur, onSearchKeyDown, onSearchSelect,
    onToggleViolationsPanel, T,
}: AppHeaderProps) {
    const statusDot = { connecting: '#EAB308', connected: '#22C55E', disconnected: '#EF4444' }[wsStatus];

    return (
        <header style={{
            height: 48, minHeight: 48, background: T.bg,
            borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12,
            zIndex: 30, flexShrink: 0,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 16, color: T.accent }}>⬡</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>Gate Keeper</span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot, display: 'inline-block', marginLeft: 2 }} />
            </div>

            <Divider />

            <button
                onClick={onShowRepoSelector}
                style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: T.border, border: `1px solid ${T.borderBright}`,
                    borderRadius: 6, color: currentRepoLabel ? T.textMuted : T.textDim,
                    cursor: 'pointer', fontSize: 12, padding: '4px 10px',
                    maxWidth: 180, overflow: 'hidden', flexShrink: 0,
                }}
            >
                <span style={{ color: T.accent, fontSize: 10 }}>◈</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentRepoLabel ?? 'All repos'}
                </span>
                {repos.length > 1 && <span style={{ color: T.textDim, marginLeft: 2 }}>▾</span>}
            </button>

            <Divider />

            <div style={{ position: 'relative', flex: '0 1 260px', minWidth: 140 }}>
                <span style={{
                    position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 12, color: T.textDim, pointerEvents: 'none',
                }}>⌕</span>
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
                        width: '100%', padding: '5px 10px 5px 28px',
                        background: T.panel, border: `1px solid ${T.border}`,
                        borderRadius: 6, color: T.text, fontSize: 12, outline: 'none',
                    }}
                />
                {showSearchDropdown && (
                    <div className="fade-in" style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                        background: T.panel, border: `1px solid ${T.borderBright}`,
                        borderRadius: 8, overflow: 'hidden', zIndex: 50,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    }}>
                        {searchResults.map(node => (
                            <SearchResultItem key={node.id} node={node} onSelect={onSearchSelect} />
                        ))}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginLeft: 4 }}>
                <HeaderStat label="Files" value={filteredGraphData.nodes.length} color={T.textMuted} />
                {overallRating != null && (
                    <HeaderStat label="Score" value={`${overallRating.toFixed(1)}`} color={ratingColor(overallRating, T)} bold />
                )}
                <HeaderStat label="Issues" value={totalViolations} color={totalViolations > 0 ? T.red : T.green} onClick={onToggleViolationsPanel} />
                {patterns.length > 0 && (
                    <HeaderStat label="Excluded" value={graphData.nodes.length - filteredGraphData.nodes.length} color={T.textDim} />
                )}
            </div>

            <div style={{ flex: 1 }} />

            <HeaderButton
                label={`⚙ Filters${patterns.length > 0 ? ` (${patterns.length})` : ''}`}
                onClick={onToggleFilterPanel}
                disabled={!selectedRepo}
                title="Manage exclude patterns"
            />
            <HeaderButton label="📋 Files" onClick={onFileListOpen} disabled={filteredGraphData.nodes.length === 0} />
            {scanning ? (
                <ScanProgressIndicator analyzed={scanProgress?.analyzed ?? 0} total={scanProgress?.total ?? 0} />
            ) : (
                <HeaderButton label="⟳ Scan" onClick={onScanAll} disabled={wsStatus !== 'connected'} primary />
            )}
            <HeaderButton label="🗑" onClick={onClearData} disabled={!selectedRepo || wsStatus !== 'connected'} danger title="Clear all data" />
            <ThemeToggleButton />
        </header>
    );
}
