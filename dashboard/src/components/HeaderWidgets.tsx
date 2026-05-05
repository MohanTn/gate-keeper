import { useTheme } from '../ThemeContext';

export function RepoLoadingOverlay() {
    const { T } = useTheme();
    return (
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', background: T.bg }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 40, height: 40, border: `3px solid ${T.border}`, borderTopColor: T.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: 13, color: T.textMuted, fontWeight: 500 }}>Loading repository…</span>
            </div>
        </div>
    );
}

export function Divider() {
    const { T } = useTheme();
    return <div style={{ width: 1, height: 20, background: T.border, flexShrink: 0 }} />;
}

export function ThemeToggleButton() {
    const { mode, toggleTheme, T } = useTheme();
    return (
        <button onClick={toggleTheme} title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, color: T.textMuted, cursor: 'pointer', fontSize: 14, flexShrink: 0, transition: 'all 0.12s' }}>
            {mode === 'dark' ? '☀️' : '🌙'}
        </button>
    );
}

export function HeaderStat({ label, value, color, bold, onClick }: {
    label: string; value: number | string; color: string; bold?: boolean; onClick?: () => void;
}) {
    const { T } = useTheme();
    return (
        <div onClick={onClick} style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, flexShrink: 0, cursor: onClick ? 'pointer' : 'default', padding: onClick ? '2px 4px' : undefined, borderRadius: onClick ? 4 : undefined }}>
            <span style={{ fontSize: 9, color: T.textDim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>{label}</span>
            <span style={{ fontSize: 15, fontWeight: bold ? 700 : 600, color }}>{value}</span>
        </div>
    );
}

function getHeaderButtonStyle(T: Record<string, string>, primary?: boolean, danger?: boolean, disabled?: boolean) {
    let bg = T.panel, borderColor = T.border, textColor = T.textMuted;
    if (primary && !disabled) { bg = T.accentDim; borderColor = T.accent; textColor = '#EFF6FF'; }
    if (danger && !disabled) { bg = '#7F1D1D'; borderColor = '#991B1B'; textColor = '#FEE2E2'; }
    if (disabled) { bg = T.panel; borderColor = T.border; textColor = T.textDim; }
    return { display: 'flex', alignItems: 'center', gap: 4, background: bg, border: `1px solid ${borderColor}`, borderRadius: 6, color: textColor, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, padding: '5px 10px', transition: 'all 0.12s', flexShrink: 0 };
}

export function HeaderButton({ label, onClick, disabled, primary, danger, title }: {
    label: string; onClick: () => void; disabled?: boolean; primary?: boolean; danger?: boolean; title?: string;
}) {
    const { T } = useTheme();
    return (
        <button onClick={onClick} disabled={disabled} title={title} style={getHeaderButtonStyle(T, primary, danger, disabled)}>{label}</button>
    );
}

function buildProgressBarStyle(T: Record<string, string>, pct: number, indeterminate: boolean) {
    return { height: '100%', borderRadius: 2, background: T.accent, transition: 'width 0.3s ease', width: indeterminate ? '40%' : `${pct}%`, animation: indeterminate ? 'progressPulse 1.5s ease-in-out infinite' : 'none' };
}

export function ScanProgressIndicator({ analyzed, total }: { analyzed: number; total: number }) {
    const { T } = useTheme();
    const pct = total > 0 ? Math.round((analyzed / total) * 100) : 0;
    const indeterminate = total === 0;
    return (
        <div title={total > 0 ? `Analyzing ${analyzed}/${total} files (${pct}%)` : 'Discovering files…'} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.panel, border: `1px solid ${T.accent}`, borderRadius: 6, padding: '5px 12px', flexShrink: 0, minWidth: 180 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.accent, animation: 'progressPulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.accent, whiteSpace: 'nowrap' }}>{total > 0 ? `${analyzed} / ${total} files` : 'Scanning…'}</span>
                    {total > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, marginLeft: 6 }}>{pct}%</span>}
                </div>
                <div style={{ height: 3, background: T.borderBright, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={buildProgressBarStyle(T, pct, indeterminate)} />
                </div>
            </div>
        </div>
    );
}

export function ScanProgressBar({ scanning, scanPct, T }: { scanning: boolean; scanPct: number | null; T: Record<string, string> }) {
    if (!scanning) return null;
    return (
        <div style={{ height: 3, background: T.border, flexShrink: 0, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: T.accent, transition: 'width 0.3s ease', width: scanPct != null ? `${scanPct}%` : '30%', animation: scanPct == null ? 'progressPulse 1.5s ease-in-out infinite' : 'none' }} />
        </div>
    );
}
