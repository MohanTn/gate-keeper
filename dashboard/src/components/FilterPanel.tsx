import React, { useCallback, useRef } from 'react';
import { useTheme } from '../ThemeContext';
import { ExcludePattern } from '../types';

const FILTER_PRESETS: Array<{ label: string; pattern: string }> = [
    { label: 'EF Core Migrations', pattern: '**/Migrations/**' },
    { label: 'Migration files (date prefix)', pattern: '*_*.Designer.cs' },
    { label: 'Designer generated', pattern: '*.Designer.cs' },
    { label: 'Auto-generated', pattern: '*.g.cs' },
    { label: 'AssemblyInfo', pattern: '**/AssemblyInfo.cs' },
    { label: 'GlobalUsings', pattern: '**/GlobalUsings.cs' },
    { label: 'Test files', pattern: '**/*Tests*' },
    { label: 'Spec files', pattern: '**/*.spec.*' },
    { label: 'Declaration files', pattern: '**/*.d.ts' },
    { label: 'Config files', pattern: '**/*.config.*' },
];

interface ScanExcludePatterns { global: string[]; csharp: string[]; typescript: string[]; }

interface FilterPanelProps {
    patterns: ExcludePattern[];
    onAdd: (pattern: string, label?: string) => void;
    onRemove: (id: number) => void;
    onClose: () => void;
    excludedCount: number; totalCount: number;
    scanExcludePatterns: ScanExcludePatterns | null;
}

function PresetButton({ preset, active, onAdd, patterns }: {
    preset: { label: string; pattern: string }; active: boolean;
    onAdd: (pattern: string, label?: string) => void; patterns: ExcludePattern[];
}) {
    const { T } = useTheme();
    const handleClick = useCallback(() => { if (!patterns.some(p => p.pattern === preset.pattern)) onAdd(preset.pattern, preset.label); }, [preset, onAdd, patterns]);
    return (
        <button onClick={handleClick} style={{ padding: '4px 10px', borderRadius: 14, background: active ? T.accentDim : T.panel, border: `1px solid ${active ? T.accent : T.border}`, color: active ? T.accent : T.textMuted, cursor: active ? 'default' : 'pointer', fontSize: 11, transition: 'all 0.12s', opacity: active ? 0.8 : 1 }}>
            {active ? '✓ ' : ''}{preset.label}
        </button>
    );
}

function PatternItem({ pattern, onRemove }: { pattern: ExcludePattern; onRemove: (id: number) => void }) {
    const { T } = useTheme();
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 6, background: T.panel, border: `1px solid ${T.border}` }}>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: T.text, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pattern.pattern}</div>
                {pattern.label && <div style={{ fontSize: 10, color: T.textDim, marginTop: 1 }}>{pattern.label}</div>}
            </div>
            <button onClick={() => onRemove(pattern.id)} style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 4, marginLeft: 8, flexShrink: 0 }} title="Remove pattern">✕</button>
        </div>
    );
}

function ScanExcludeSection({ scanExcludePatterns, T }: { scanExcludePatterns: ScanExcludePatterns; T: Record<string, string> }) {
    const langLabels: Record<string, string> = { global: 'All Languages', csharp: 'C# / .NET', typescript: 'TypeScript / JavaScript' };
    return (
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 11, color: T.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Scan-Level Excludes <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>(~/.gate-keeper/config.json)</span>
            </div>
            <div style={{ fontSize: 10, color: T.textDim, marginBottom: 6 }}>Files matching these patterns are never scanned. Edit the config file to change.</div>
            {(['global', 'csharp', 'typescript'] as const).map(lang => {
                const list = scanExcludePatterns[lang];
                if (!list || list.length === 0) return null;
                return (
                    <div key={lang} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 3, fontWeight: 600 }}>{langLabels[lang]}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {list.map(p => (<span key={p} style={{ padding: '2px 8px', borderRadius: 10, background: T.elevated, border: `1px solid ${T.border}`, color: T.textDim, fontSize: 10, fontFamily: 'monospace' }}>{p}</span>))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function FilterPanel({ patterns, onAdd, onRemove, onClose, excludedCount, totalCount, scanExcludePatterns }: FilterPanelProps) {
    const { T } = useTheme();
    const inputRef = useRef<HTMLInputElement>(null);
    const activePresets = new Set(patterns.map(p => p.pattern));

    const handleFormSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const input = inputRef.current;
        if (!input || !input.value.trim()) return;
        onAdd(input.value.trim()); input.value = ''; input.focus();
    }, [onAdd]);

    return (
        <div className="slide-in-right" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '90vw', background: T.bg, borderLeft: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', zIndex: 40, boxShadow: '-8px 0 32px rgba(0,0,0,0.3)' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Exclude Filters</div>
                    <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>{excludedCount > 0 ? `Hiding ${excludedCount} of ${totalCount} files` : 'Hide files by pattern'}</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1 }}>✕</button>
            </div>
            <form onSubmit={handleFormSubmit} style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, color: T.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Custom Pattern</div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input ref={inputRef} type="text" name="pattern" placeholder="e.g. **/Migrations/**" style={{ flex: 1, padding: '7px 10px', background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 12, outline: 'none' }} />
                    <button type="submit" style={{ padding: '7px 14px', background: T.accentDim, border: `1px solid ${T.accent}`, borderRadius: 6, color: '#EFF6FF', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Add</button>
                </div>
                <div style={{ fontSize: 10, color: T.textDim, marginTop: 4 }}>Glob: <code style={{ color: T.textFaut }}>*</code> matches filename, <code style={{ color: T.textFaint }}>**</code> matches paths</div>
            </form>
            <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, color: T.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Quick Presets</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {FILTER_PRESETS.map(preset => (<PresetButton key={preset.pattern} preset={preset} active={activePresets.has(preset.pattern)} onAdd={onAdd} patterns={patterns} />))}
                </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
                <div style={{ fontSize: 11, color: T.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Active Filters ({patterns.length})</div>
                {patterns.length === 0 ? (<div style={{ fontSize: 12, color: T.textDim, padding: '20px 0', textAlign: 'center' }}>No exclude patterns configured.</div>) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{patterns.map(p => (<PatternItem key={p.id} pattern={p} onRemove={onRemove} />))}</div>
                )}
            </div>
            {scanExcludePatterns && <ScanExcludeSection scanExcludePatterns={scanExcludePatterns} T={T} />}
        </div>
    );
}
