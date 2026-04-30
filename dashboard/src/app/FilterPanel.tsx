import React, { useCallback, useRef } from 'react';
import { ThemeTokens } from '../ThemeContext';
import { ExcludePattern } from '../types';
import { ScanExcludePatterns } from './useDashboardState';

const FILTER_PRESETS = [
    { label: 'EF Core Migrations', pattern: '**/Migrations/**' },
    { label: 'Migration files', pattern: '*_*.Designer.cs' },
    { label: 'Designer generated', pattern: '*.Designer.cs' },
    { label: 'Auto-generated', pattern: '*.g.cs' },
    { label: 'AssemblyInfo', pattern: '**/AssemblyInfo.cs' },
    { label: 'GlobalUsings', pattern: '**/GlobalUsings.cs' },
    { label: 'Test files', pattern: '**/*Tests*' },
    { label: 'Spec files', pattern: '**/*.spec.*' },
    { label: 'Declaration files', pattern: '**/*.d.ts' },
    { label: 'Config files', pattern: '**/*.config.*' },
];

export function FilterPanel({ patterns, onAdd, onRemove, onClose, excludedCount, totalCount, scanExcludePatterns, T }: {
    patterns: ExcludePattern[];
    onAdd: (p: string, l?: string) => void;
    onRemove: (id: number) => void;
    onClose: () => void;
    excludedCount: number;
    totalCount: number;
    scanExcludePatterns: ScanExcludePatterns | null;
    T: ThemeTokens;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const v = inputRef.current?.value.trim();
        if (v) {
            onAdd(v);
            if (inputRef.current) {
                inputRef.current.value = '';
                inputRef.current.focus();
            }
        }
    }, [onAdd]);
    const activePresets = new Set(patterns.map(p => p.pattern));

    return (
        <div style={{ background: T.bg, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Exclude Filters</div>
                    <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{excludedCount > 0 ? `Hiding ${excludedCount} of ${totalCount} files` : 'Hide files by pattern'}</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Custom Pattern</div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input ref={inputRef} type="text" placeholder="e.g. **/Migrations/**" style={{ flex: 1, padding: '8px 12px', background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 13, outline: 'none' }} />
                    <button type="submit" style={{ padding: '8px 16px', background: T.accentDim, border: `1px solid ${T.accent}`, borderRadius: 6, color: '#EFF6FF', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Add</button>
                </div>
            </form>
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 12, color: T.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Quick Presets</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {FILTER_PRESETS.map(p => {
                        const active = activePresets.has(p.pattern);
                        return <button key={p.pattern} onClick={() => { if (!active) onAdd(p.pattern, p.label); }} style={{ padding: '5px 12px', borderRadius: 14, background: active ? T.accent + '22' : T.panel, border: `1px solid ${active ? T.accent : T.border}`, color: active ? T.accent : T.textMuted, cursor: active ? 'default' : 'pointer', fontSize: 12, opacity: active ? 0.7 : 1 }}>{active ? '✓ ' : ''}{p.label}</button>;
                    })}
                </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
                <div style={{ fontSize: 12, color: T.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Active Filters ({patterns.length})</div>
                {patterns.length === 0 ? <div style={{ fontSize: 13, color: T.textDim, padding: '20px 0', textAlign: 'center' }}>No exclude patterns.</div> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {patterns.map(p => (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 6, background: T.panel, border: `1px solid ${T.border}` }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 13, color: T.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.pattern}</div>
                                    {p.label && <div style={{ fontSize: 11, color: T.textDim, marginTop: 1 }}>{p.label}</div>}
                                </div>
                                <button onClick={() => onRemove(p.id)} style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', fontSize: 15, padding: '2px 6px', borderRadius: 4, marginLeft: 8, flexShrink: 0 }}>✕</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {scanExcludePatterns && (
                <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Scan-Level Excludes</div>
                    {(['global', 'csharp', 'typescript'] as const).map(lang => {
                        const list = scanExcludePatterns[lang];
                        if (!list?.length) return null;
                        return (
                            <div key={lang} style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 3, fontWeight: 600 }}>{lang === 'global' ? 'All' : lang === 'csharp' ? 'C#' : 'TS/JS'}</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {list.map(p => <span key={p} style={{ padding: '3px 8px', borderRadius: 10, background: T.elevated, border: `1px solid ${T.border}`, color: T.textDim, fontSize: 11, fontFamily: 'monospace' }}>{p}</span>)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
