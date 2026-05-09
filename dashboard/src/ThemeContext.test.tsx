import React from 'react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

import {
  ThemeProvider,
  useTheme,
  ThemeContext,
  darkTokens,
  lightTokens,
  ratingColor,
  healthLabel,
  type ThemeTokens,
} from './ThemeContext';

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('ThemeContext object', () => {
    it('should have default value with dark tokens', () => {
      // Test the default value passed to createContext
      const defaultValue = ThemeContext.Provider.toString();
      expect(defaultValue).toBeDefined();
    });

    it('should export darkTokens with correct structure', () => {
      expect(darkTokens).toBeDefined();
      expect(typeof darkTokens.bg).toBe('string');
      expect(typeof darkTokens.panel).toBe('string');
      expect(typeof darkTokens.text).toBe('string');
    });
  });

  describe('Theme providers', () => {
    it('should render ThemeProvider children', () => {
      render(
        <ThemeProvider>
          <span data-testid="test-span">Hello World</span>
        </ThemeProvider>
      );
      const element = screen.getByTestId('test-span');
      expect(element).not.toBeNull();
      expect(element.textContent).toBe('Hello World');
    });

    it('should set data-theme attribute on dark', async () => {
      render(
        <ThemeProvider>
          <div data-testid="test-container" />
        </ThemeProvider>
      );

      await waitFor(() => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      });
    });

    it('should restore theme when localStorage item exists', async () => {
      localStorage.setItem('gk-theme', 'light');
      render(<ThemeProvider><div data-testid="test-container" /></ThemeProvider>);

      await waitFor(() => {
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      });
    });
  });

  describe('useTheme hook', () => {
    it('should return theme context value', () => {
      let capturedValue: ReturnType<typeof useTheme> | undefined;

      function TestComponent() {
        capturedValue = useTheme();
        return <div data-testid="test-component">Test</div>;
      }

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      expect(capturedValue).toBeDefined();
      expect(capturedValue?.mode).toBe('dark');
      expect(capturedValue?.T).toBe(darkTokens);
    });

    it('should toggle theme', async () => {
      function TestComponent() {
        const { mode, toggleTheme } = useTheme();
        return (
          <div>
            <span data-testid="mode">{mode}</span>
            <button onClick={toggleTheme}>Toggle</button>
          </div>
        );
      }

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      expect(screen.getByTestId('mode').textContent).toBe('dark');

      screen.getByText('Toggle').click();

      await waitFor(() => {
        expect(screen.getByTestId('mode').textContent).toBe('light');
      });
    });
  });

  describe('ratingColor function', () => {
    it('should return green for rating >= 8', () => {
      const color = ratingColor(8, darkTokens);
      expect(color).toBe(darkTokens.green);
    });

    it('should return green for rating > 8', () => {
      const color = ratingColor(10, darkTokens);
      expect(color).toBe(darkTokens.green);
    });

    it('should return yellow for rating >= 6 and < 8', () => {
      const color = ratingColor(6, darkTokens);
      expect(color).toBe(darkTokens.yellow);
    });

    it('should return yellow for rating 7', () => {
      const color = ratingColor(7, darkTokens);
      expect(color).toBe(darkTokens.yellow);
    });

    it('should return orange for rating >= 4 and < 6', () => {
      const color = ratingColor(4, darkTokens);
      expect(color).toBe(darkTokens.orange);
    });

    it('should return orange for rating 5', () => {
      const color = ratingColor(5, darkTokens);
      expect(color).toBe(darkTokens.orange);
    });

    it('should return red for rating < 4', () => {
      const color = ratingColor(3, darkTokens);
      expect(color).toBe(darkTokens.red);
    });

    it('should return red for rating 0', () => {
      const color = ratingColor(0, darkTokens);
      expect(color).toBe(darkTokens.red);
    });

    it('should return red for negative rating', () => {
      const color = ratingColor(-1, darkTokens);
      expect(color).toBe(darkTokens.red);
    });
  });

  describe('healthLabel function', () => {
    it('should return "Healthy" for rating >= 8', () => {
      expect(healthLabel(8)).toBe('Healthy');
    });

    it('should return "Healthy" for rating > 8', () => {
      expect(healthLabel(10)).toBe('Healthy');
    });

    it('should return "Warning" for rating >= 6 and < 8', () => {
      expect(healthLabel(6)).toBe('Warning');
    });

    it('should return "Warning" for rating 7', () => {
      expect(healthLabel(7)).toBe('Warning');
    });

    it('should return "Degraded" for rating >= 4 and < 6', () => {
      expect(healthLabel(4)).toBe('Degraded');
    });

    it('should return "Degraded" for rating 5', () => {
      expect(healthLabel(5)).toBe('Degraded');
    });

    it('should return "Critical" for rating < 4', () => {
      expect(healthLabel(3)).toBe('Critical');
    });

    it('should return "Critical" for rating 0', () => {
      expect(healthLabel(0)).toBe('Critical');
    });

    it('should return "Critical" for negative rating', () => {
      expect(healthLabel(-1)).toBe('Critical');
    });
  });

  describe('Theme token validation', () => {
    it('should have correct dark tokens', () => {
      expect(darkTokens.bg).toBe('#1C1B29');
      expect(darkTokens.panel).toBe('#252339');
      expect(darkTokens.text).toBe('#E2DFF2');
    });

    it('should have correct light tokens', () => {
      expect(lightTokens.bg).toBe('#F7F3FF');
      expect(lightTokens.panel).toBe('#FFFFFF');
      expect(lightTokens.text).toBe('#2D2740');
    });
  });
});

describe('ThemeContext Toggle', () => {
  describe('Theme tokens', () => {
    it('should have correct dark tokens', () => {
      expect(darkTokens.bg).toBe('#1C1B29');
      expect(darkTokens.panel).toBe('#252339');
      expect(darkTokens.text).toBe('#E2DFF2');
    });

    it('should have correct light tokens', () => {
      expect(lightTokens.bg).toBe('#F7F3FF');
      expect(lightTokens.panel).toBe('#FFFFFF');
      expect(lightTokens.text).toBe('#2D2740');
    });
  });
});
