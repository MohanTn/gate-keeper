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
  bg: '#1C1B29',
  panel: '#252339',
  panelHover: '#2E2C47',
  elevated: '#211F32',
  border: '#343158',
  borderBright: '#45416B',
  text: '#E2DFF2',
  textMuted: '#A5A0C5',
  textFaint: '#7D78A0',
  textDim: '#58547A',
  green: '#A8D5BA',
  yellow: '#EED9A0',
  orange: '#EDBC9B',
  red: '#E8A0A0',
  accent: '#AD9EFF',
  accentDim: '#8A7AD8',
  cardBg: '#252339',
  cardBgHover: '#2E2C47',
  edgeDefault: 'rgba(173,158,255,0.30)',
  edgeHighlight: 'rgba(173,158,255,0.85)',
  edgeDim: 'rgba(173,158,255,0.06)',
  edgeCircular: 'rgba(232,160,160,0.50)',
  backdrop: 'rgba(0,0,0,0.5)',
  shadow: 'rgba(0,0,0,0.3)',
};

export const lightTokens: ThemeTokens = {
  bg: '#F7F3FF',
  panel: '#FFFFFF',
  panelHover: '#EFEBF9',
  elevated: '#F2EDFC',
  border: '#DDD6EC',
  borderBright: '#C6BCDF',
  text: '#2D2740',
  textMuted: '#6C6385',
  textFaint: '#9288AD',
  textDim: '#B5ABCC',
  green: '#7DA08A',
  yellow: '#C9B060',
  orange: '#C9905A',
  red: '#C97A75',
  accent: '#8579E8',
  accentDim: '#6658CC',
  cardBg: '#FFFFFF',
  cardBgHover: '#EFEBF9',
  edgeDefault: 'rgba(133,121,232,0.25)',
  edgeHighlight: 'rgba(133,121,232,0.80)',
  edgeDim: 'rgba(133,121,232,0.08)',
  edgeCircular: 'rgba(201,122,117,0.45)',
  backdrop: 'rgba(0,0,0,0.2)',
  shadow: 'rgba(0,0,0,0.08)',
};

interface ThemeContextValue {
  T: ThemeTokens;
  mode: 'dark' | 'light';
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
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
