import React, { useCallback } from 'react';
import { useTheme } from '../ThemeContext';
import { ratingColor } from '../ThemeContext';
import { GraphNode, RepoInfo } from '../types';
export function SearchResultItem({ node, onSelect }: { node: GraphNode; onSelect: (node: GraphNode) => void }) {
    const { T } = useTheme();
    const handleMouseDown = useCallback(() => onSelect(node), [node, onSelect]);
    return (
        <div
            className="search-result-item"
            onMouseDown={handleMouseDown}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${T.border}`,
            }}
        >
            <span style={{ fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.label}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: ratingColor(node.rating, T), marginLeft: 8, flexShrink: 0 }}>
                {node.rating}
            </span>
        </div>
    );
}

export function RepoSelectorModal({ repos, selectedRepo, onSelect, onClose, onDelete }: {
    repos: RepoInfo[];
    selectedRepo: string | null;
    onSelect: (repo: string) => void;
    onClose: () => void;
    onDelete: (repoRoot: string) => void;
}) {
    const { T } = useTheme();
    const handleDomEvent = useCallback(
        (e: React.MouseEvent) => {
            if (e.currentTarget === e.target) onClose();
            else e.stopPropagation();
        },
        [onClose]
    );
    return (
        <div
            onClick={handleDomEvent}
            style={{
                position: 'fixed', inset: 0, zIndex: 100,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
        >
            <div
                onClick={handleDomEvent}
                className="fade-in"
                style={{
                    background: T.bg, border: `1px solid ${T.border}`,
                    borderRadius: 12, padding: 24, minWidth: 360, maxWidth: 520,
                }}
            >
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                    Select Repository
                </div>
                <div style={{ fontSize: 12, color: T.textDim, marginBottom: 20 }}>
                    Pick a repository to view its dependency map.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {repos.map(r => (
                        <RepoButton key={r.repoRoot} repo={r} isSelected={selectedRepo === r.repoRoot} onSelect={onSelect} onDelete={onDelete} />
                    ))}
                </div>
                <button
                    onClick={onClose}
                    style={{
                        marginTop: 16, width: '100%', padding: '8px 0',
                        background: 'transparent', border: `1px solid ${T.border}`,
                        borderRadius: 6, color: T.textDim, cursor: 'pointer', fontSize: 12,
                    }}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

function RepoButton({ repo, isSelected, onSelect, onDelete }: {
    repo: RepoInfo;
    isSelected: boolean;
    onSelect: (repo: string) => void;
    onDelete: (repoRoot: string) => void;
}) {
    const { T } = useTheme();
    const handleClick = useCallback(() => onSelect(repo.repoRoot), [repo.repoRoot, onSelect]);
    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm(`Delete "${repo.label}" and all its analysis data? This cannot be undone.`)) return;
        fetch('/api/repos', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repoRoot: repo.repoRoot }),
        })
            .then(r => r.json())
            .then(() => onDelete(repo.repoRoot))
            .catch(() => alert('Failed to delete repository'));
    }, [repo.repoRoot, repo.label, onDelete]);
    const handleMouse = useCallback((e: React.MouseEvent<HTMLButtonElement>, enter: boolean) => {
        (e.currentTarget as HTMLButtonElement).style.color = enter ? T.red : T.textMuted;
        (e.currentTarget as HTMLButtonElement).style.borderColor = enter ? T.red : T.border;
    }, [T.red, T.textMuted, T.border]);

    return (
        <div style={{
            display: 'flex', alignItems: 'center',
            background: isSelected ? T.accentDim : T.panel,
            border: `1px solid ${isSelected ? T.accent : T.border}`,
            borderRadius: 8, overflow: 'hidden', transition: 'all 0.12s',
        }}>
            <button
                onClick={handleClick}
                style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'transparent', border: 'none', padding: '10px 14px', cursor: 'pointer',
                    color: T.text, textAlign: 'left',
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{repo.label}</span>
                        {repo.sessionType && repo.sessionType !== 'unknown' && (
                            <span style={{
                                fontSize: 10, fontWeight: 500,
                                padding: '1px 6px', borderRadius: 3,
                                background: T.elevated, color: T.textMuted,
                                border: `1px solid ${T.border}`,
                            }}>
                                {repo.sessionType === 'claude' ? 'Claude' : 'Copilot'}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 11, color: T.textDim, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {repo.repoRoot}
                    </div>
                </div>
                <div style={{ fontSize: 12, color: T.textFaint, marginLeft: 16, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {repo.fileCount} file{repo.fileCount !== 1 ? 's' : ''}
                </div>
            </button>
            <button
                onClick={handleDelete}
                title="Delete repository and all analysis data"
                style={{
                    flexShrink: 0, marginRight: 6,
                    background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 4,
                    padding: '4px 10px',
                    cursor: 'pointer', color: T.textMuted, fontSize: 11, transition: 'all 0.12s',
                }}
                onMouseEnter={(e) => handleMouse(e, true)}
                onMouseLeave={(e) => handleMouse(e, false)}
            >
                Delete
            </button>
        </div>
    );
}
