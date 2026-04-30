import React from 'react';
import { ThemeTokens } from '../ThemeContext';
import { GateKeeperConfig } from '../types';

export function ConfigEditorModal({ config, onChange, onSave, onClose, saving, saveStatus, T }: {
    config: GateKeeperConfig;
    onChange: (c: GateKeeperConfig) => void;
    onSave: () => void;
    onClose: () => void;
    saving: boolean;
    saveStatus: 'idle' | 'success' | 'error';
    T: ThemeTokens;
}) {
    const updateMinRating = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0 && val <= 10) onChange({ ...config, minRating: val });
    };

    const updatePatterns = (lang: 'global' | 'csharp' | 'typescript', value: string) => {
        onChange({ ...config, scanExcludePatterns: { ...config.scanExcludePatterns, [lang]: value.split('\n').map(l => l.trim()).filter(Boolean) } });
    };

    return (
        <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 100, background: T.backdrop, backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="fade-in" onClick={e => e.stopPropagation()} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, width: 540, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto', boxShadow: `0 25px 60px ${T.shadow}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Gate Keeper Configuration</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 20 }}>✕</button>
                </div>
                <div style={{ fontSize: 13, color: T.textDim, marginBottom: 20 }}>
                    Settings stored in <code style={{ color: T.textFaint, background: T.elevated, padding: '2px 6px', borderRadius: 4 }}>~/.gate-keeper/config.json</code>
                </div>

                <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 8 }}>Minimum Rating Threshold</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <input type="range" min="0" max="10" step="0.5" value={config.minRating} onChange={updateMinRating} style={{ flex: 1 }} />
                        <input type="number" min="0" max="10" step="0.5" value={config.minRating} onChange={updateMinRating} style={{ width: 70, padding: '6px 10px', background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 15, textAlign: 'center', outline: 'none' }} />
                    </div>
                </div>

                {(['global', 'csharp', 'typescript'] as const).map(lang => {
                    const labels = { global: 'Global Exclude Patterns', csharp: 'C# Exclude Patterns', typescript: 'TypeScript/JS Exclude Patterns' };
                    return (
                        <div key={lang} style={{ marginBottom: 16 }}>
                            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 6 }}>{labels[lang]}</label>
                            <textarea value={(config.scanExcludePatterns?.[lang] ?? []).join('\n')} onChange={e => updatePatterns(lang, e.target.value)} rows={4} placeholder="One pattern per line" style={{ width: '100%', padding: '8px 12px', background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 13, fontFamily: 'monospace', resize: 'vertical', outline: 'none', lineHeight: 1.6 }} />
                        </div>
                    );
                })}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
                    {saveStatus === 'success' && <span style={{ fontSize: 13, color: T.green, alignSelf: 'center', marginRight: 8 }}>✓ Saved</span>}
                    {saveStatus === 'error' && <span style={{ fontSize: 13, color: T.red, alignSelf: 'center', marginRight: 8 }}>Save failed</span>}
                    <button onClick={onClose} style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textMuted, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                    <button onClick={onSave} disabled={saving} style={{ padding: '8px 18px', background: T.accentDim, border: `1px solid ${T.accent}`, borderRadius: 6, color: '#EFF6FF', cursor: saving ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
            </div>
        </div>
    );
}
