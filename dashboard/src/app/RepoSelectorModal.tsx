import React from 'react';
import { ThemeTokens } from '../ThemeContext';
import { RepoInfo } from '../types';

function ClaudeIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M16.1 3.68l-4.03 16.58a.59.59 0 0 1-.57.46.6.6 0 0 1-.14-.02.59.59 0 0 1-.44-.71L14.95 3.4a.59.59 0 0 1 1.15.28zM8.52 5.12l2.72 4.17-2.1 3.5-4.63-7.67a.59.59 0 0 1 1.01-.59l2.05 3.4L8.52 5.12zm7.69 6.79L21.03 19a.59.59 0 0 1-1.01.6l-4.63-7.68 2.1-3.5-.56.94.33.55-1.05 1.99z" fill="#D97757" />
        </svg>
    );
}

function CopilotIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V7h2v5zm4 4h-2v-2h2v2zm0-4h-2V7h2v5z" fill="#86EFAC" />
            <path d="M12 4c-1.1 0-2.1.23-3.06.63C10.58 5.54 12 7.6 12 10c0 2.4-1.42 4.46-3.06 5.37A7.96 7.96 0 0 0 12 20a8 8 0 0 0 0-16z" fill="#22C55E" />
            <circle cx="9.5" cy="11" r="1.5" fill="#0B1120" />
            <circle cx="14.5" cy="11" r="1.5" fill="#0B1120" />
        </svg>
    );
}

export function RepoSelectorModal({ repos, selectedRepo, onSelect, onClose, onDelete, onDeselect, T }: {
    repos: RepoInfo[];
    selectedRepo: string | null;
    onSelect: (r: string) => void;
    onClose: () => void;
    onDelete: () => void;
    onDeselect: () => void;
    T: ThemeTokens;
}) {
    return (
        <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 100, background: T.backdrop, backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="fade-in" onClick={e => e.stopPropagation()} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, minWidth: 380, maxWidth: 540, boxShadow: `0 25px 60px ${T.shadow}` }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 6 }}>Select Repository</div>
                <div style={{ fontSize: 13, color: T.textDim, marginBottom: 20 }}>Pick a repository to view its dependency map.</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {repos.map(r => <RepoButton key={r.repoRoot} repo={r} isSelected={selectedRepo === r.repoRoot} onSelect={onSelect} onDelete={onDelete} onDeselect={onDeselect} T={T} />)}
                </div>
                <button onClick={onClose} style={{ marginTop: 16, width: '100%', padding: '9px 0', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textDim, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            </div>
        </div>
    );
}

function RepoButton({ repo, isSelected, onSelect, onDelete, onDeselect, T }: {
    repo: RepoInfo;
    isSelected: boolean;
    onSelect: (r: string) => void;
    onDelete: () => void;
    onDeselect: () => void;
    T: ThemeTokens;
}) {
    const handleClick = () => onSelect(repo.repoRoot);
    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm(`Delete "${repo.label}" and all its analysis data?`)) return;
        fetch('/api/repos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoRoot: repo.repoRoot }) })
            .then(r => r.json()).then(() => { if (isSelected) onDeselect(); onDelete(); }).catch(() => alert('Failed to delete'));
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: isSelected ? T.accent + '22' : T.panel, border: `1px solid ${isSelected ? T.accent : T.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={handleClick} style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: '12px 14px', cursor: 'pointer', color: T.text, textAlign: 'left' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        {repo.sessionType && repo.sessionType !== 'unknown' && (repo.sessionType === 'claude' ? <ClaudeIcon size={18} /> : <CopilotIcon size={18} />)}
                        <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{repo.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: T.textDim, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.repoRoot}</div>
                </div>
                <div style={{ fontSize: 13, color: T.textFaint, marginLeft: 16, whiteSpace: 'nowrap', flexShrink: 0 }}>{repo.fileCount} file{repo.fileCount !== 1 ? 's' : ''}</div>
            </button>
            <button onClick={handleDelete} title="Delete repository" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, marginRight: 8, background: 'transparent', border: '1px solid transparent', borderRadius: 4, cursor: 'pointer', color: T.textDim }}>✕</button>
        </div>
    );
}
