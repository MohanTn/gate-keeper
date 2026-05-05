import React, { useCallback } from 'react';
import { useTheme } from '../ThemeContext';
import { ratingColor } from '../ThemeContext';
import { GraphNode, RepoInfo } from '../types';
import { ClaudeIcon, CopilotIcon } from './icons/BrandIcons';

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

export function RepoSelectorModal({ repos, selectedRepo, onSelect, onClose }: {
    repos: RepoInfo[];
    selectedRepo: string | null;
    onSelect: (repo: string) => void;
    onClose: () => void;
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
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
        >
            <div
                onClick={handleDomEvent}
                className="fade-in"
                style={{
                    background: T.bg, border: `1px solid ${T.border}`,
                    borderRadius: 12, padding: 24, minWidth: 360, maxWidth: 520,
                    boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
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
                        <RepoButton key={r.repoRoot} repo={r} isSelected={selectedRepo === r.repoRoot} onSelect={onSelect} />
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

function RepoButton({ repo, isSelected, onSelect }: {
    repo: RepoInfo;
    isSelected: boolean;
    onSelect: (repo: string) => void;
}) {
    const { T } = useTheme();
    const handleClick = useCallback(() => onSelect(repo.repoRoot), [repo.repoRoot, onSelect]);
    return (
        <button
            onClick={handleClick}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: isSelected ? T.accentDim : T.panel,
                border: `1px solid ${isSelected ? T.accent : T.border}`,
                borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                color: T.text, textAlign: 'left', transition: 'all 0.12s',
            }}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    {repo.sessionType && repo.sessionType !== 'unknown' && (
                        repo.sessionType === 'claude' ? <ClaudeIcon size={18} /> : <CopilotIcon size={18} />
                    )}
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{repo.label}</span>
                    {repo.sessionType && repo.sessionType !== 'unknown' && (
                        <span style={{
                            fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
                            padding: '1px 6px', borderRadius: 4,
                            background: T.accentDim, color: T.accent,
                            border: `1px solid ${T.accent}`,
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
    );
}
