import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface ThemeTokens {
  bg: string;
  panel: string;
  panelHover: string;
  elevated: string;
  border: string;
  borderBright: string;
  text: string;
  textMuted: string;
  textFaint: string;
  textDim: string;
  green: string;
  yellow: string;
  orange: string;
  red: string;
  accent: string;
  accentDim: string;
  cardBg: string;
  cardBgHover: string;
  edgeDefault: string;
  edgeHighlight: string;
  edgeDim: string;
  edgeCircular: string;
  backdrop: string;
  shadow: string;
}

export const darkTokens: ThemeTokens = {
  bg: '#0B1120',
  panel: '#111827',
  panelHover: '#1A2332',
  elevated: '#0F172A',
  border: '#1E293B',
  borderBright: '#2D3F55',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textFaint: '#64748B',
  textDim: '#475569',
  green: '#22C55E',
  yellow: '#EAB308',
  orange: '#F97316',
  red: '#EF4444',
  accent: '#3B82F6',
  accentDim: '#1D4ED8',
  cardBg: '#111827',
  cardBgHover: '#1A2332',
  edgeDefault: 'rgba(59,130,246,0.30)',
  edgeHighlight: 'rgba(59,130,246,0.90)',
  edgeDim: 'rgba(59,130,246,0.05)',
  edgeCircular: 'rgba(249,115,22,0.50)',
  backdrop: 'rgba(0,0,0,0.6)',
  shadow: 'rgba(0,0,0,0.4)',
};

export const lightTokens: ThemeTokens = {
  bg: '#F8FAFC',
  panel: '#FFFFFF',
  panelHover: '#F1F5F9',
  elevated: '#F1F5F9',
  border: '#E2E8F0',
  borderBright: '#CBD5E1',
  text: '#0F172A',
  textMuted: '#475569',
  textFaint: '#64748B',
  textDim: '#94A3B8',
  green: '#16A34A',
  yellow: '#CA8A04',
  orange: '#EA580C',
  red: '#DC2626',
  accent: '#2563EB',
  accentDim: '#1E40AF',
  cardBg: '#FFFFFF',
  cardBgHover: '#F1F5F9',
  edgeDefault: 'rgba(37,99,235,0.25)',
  edgeHighlight: 'rgba(37,99,235,0.80)',
  edgeDim: 'rgba(37,99,235,0.08)',
  edgeCircular: 'rgba(234,88,12,0.45)',
  backdrop: 'rgba(0,0,0,0.3)',
  shadow: 'rgba(0,0,0,0.15)',
};

interface ThemeContextValue {
  T: ThemeTokens;
  mode: 'dark' | 'light';
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  T: darkTokens,
  mode: 'dark',
  toggleTheme: () => { },
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'dark' | 'light'>(() => {
    try {
      const stored = localStorage.getItem('gk-theme');
      return stored === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  const toggleTheme = useCallback(() => {
    setMode(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('gk-theme', next); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  const T = mode === 'dark' ? darkTokens : lightTokens;

  return (
    <ThemeContext.Provider value={{ T, mode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ratingColor(r: number, T: ThemeTokens): string {
  if (r >= 8) return T.green;
  if (r >= 6) return T.yellow;
  if (r >= 4) return T.orange;
  return T.red;
}

export function healthLabel(r: number): string {
  if (r >= 8) return 'Healthy';
  if (r >= 6) return 'Warning';
  if (r >= 4) return 'Degraded';
  return 'Critical';
}
