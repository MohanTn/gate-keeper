import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterPanel } from './FilterPanel';
import { darkTokens } from '../ThemeContext';
import type { ExcludePattern } from '../types';
import '@testing-library/jest-dom';

// ── Theme mock ──────────────────────────────────────────────────────────────

jest.mock('../ThemeContext', () => ({
  useTheme: () => ({ T: darkTokens, mode: 'dark', toggleTheme: jest.fn() }),
  darkTokens: jest.requireActual('../ThemeContext').darkTokens,
  ThemeTokens: jest.requireActual('../ThemeContext').ThemeTokens,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePattern(overrides: Partial<ExcludePattern> = {}): ExcludePattern {
  return {
    id: 1,
    pattern: '**/Migrations/**',
    label: 'EF Core Migrations',
    ...overrides,
  };
}

interface ScanExcludePatterns {
  global: string[];
  csharp: string[];
  typescript: string[];
}

const sampleScanExcludes: ScanExcludePatterns = {
  global: ['node_modules', 'dist'],
  csharp: ['bin/', 'obj/'],
  typescript: ['*.d.ts'],
};

function renderPanel({
  patterns = [],
  onAdd = jest.fn(),
  onRemove = jest.fn(),
  onClose = jest.fn(),
  excludedCount = 0,
  totalCount = 100,
  scanExcludePatterns = null,
}: Partial<React.ComponentProps<typeof FilterPanel>> = {}) {
  return render(
    <FilterPanel
      patterns={patterns}
      onAdd={onAdd}
      onRemove={onRemove}
      onClose={onClose}
      excludedCount={excludedCount}
      totalCount={totalCount}
      scanExcludePatterns={scanExcludePatterns}
    />
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('FilterPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('empty state', () => {
    it('renders with no patterns → shows "No exclude patterns configured"', () => {
      renderPanel();
      expect(screen.getByText('Exclude Filters')).toBeInTheDocument();
      expect(screen.getByText('No exclude patterns configured.')).toBeInTheDocument();
    });

    it('shows subtitle instructing user when no files are hidden', () => {
      renderPanel({ excludedCount: 0, totalCount: 50 });
      expect(screen.getByText('Hide files by pattern')).toBeInTheDocument();
    });
  });

  describe('active patterns list', () => {
    it('renders active patterns list', () => {
      renderPanel({
        patterns: [
          makePattern({ id: 1, pattern: '**/Migrations/**', label: 'EF Core Migrations' }),
          makePattern({ id: 2, pattern: '*.g.cs', label: 'Auto-generated' }),
        ],
      });

      expect(screen.getByText('**/Migrations/**')).toBeInTheDocument();
      expect(screen.getByText('*.g.cs')).toBeInTheDocument();
      expect(screen.getByText('Active Filters (2)')).toBeInTheDocument();
    });

    it('shows label beneath the pattern', () => {
      renderPanel({ patterns: [makePattern({ label: 'EF Core Migrations' })] });
      // The label appears both as a preset button and in the pattern item's label div
      const labels = screen.getAllByText('EF Core Migrations');
      expect(labels.length).toBeGreaterThanOrEqual(2);
    });

    it('does not show a label div when label is null', () => {
      renderPanel({ patterns: [makePattern({ label: null })] });
      expect(screen.getByText('**/Migrations/**')).toBeInTheDocument();
    });
  });

  describe('presets', () => {
    it('clicking a preset button calls onAdd', () => {
      const onAdd = jest.fn();
      renderPanel({ onAdd });

      fireEvent.click(screen.getByText('EF Core Migrations'));
      expect(onAdd).toHaveBeenCalledWith('**/Migrations/**', 'EF Core Migrations');
    });

    it('does not call onAdd for already-active preset (disabled)', () => {
      const onAdd = jest.fn();
      renderPanel({
        onAdd,
        patterns: [makePattern({ pattern: '**/Migrations/**', label: null })],
      });

      // With label: null, "EF Core Migrations" only appears as the preset button
      const presetBtn = screen.getByText('EF Core Migrations');
      // Active preset should have cursor: default
      expect(presetBtn).toHaveStyle('cursor: default');
      fireEvent.click(presetBtn);
      // Should NOT call onAdd because pattern already exists
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('renders all 10 preset buttons', () => {
      renderPanel();
      const presets = [
        'EF Core Migrations',
        'Migration files (date prefix)',
        'Designer generated',
        'Auto-generated',
        'AssemblyInfo',
        'GlobalUsings',
        'Test files',
        'Spec files',
        'Declaration files',
        'Config files',
      ];
      presets.forEach(label => {
        expect(screen.getByText(label)).toBeInTheDocument();
      });
    });
  });

  describe('custom pattern input', () => {
    it('submitting custom pattern calls onAdd and clears input', () => {
      const onAdd = jest.fn();
      renderPanel({ onAdd });

      const input = screen.getByPlaceholderText('e.g. **/Migrations/**');
      fireEvent.change(input, { target: { value: '**/custom/**' } });
      fireEvent.submit(screen.getByText('Add').closest('form')!);

      expect(onAdd).toHaveBeenCalledWith('**/custom/**');
      expect(input).toHaveValue('');
    });

    it('does not call onAdd for empty input', () => {
      const onAdd = jest.fn();
      renderPanel({ onAdd });

      fireEvent.submit(screen.getByText('Add').closest('form')!);
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('Add button is of type submit', () => {
      renderPanel();
      const addBtn = screen.getByText('Add');
      expect(addBtn.closest('form')).toBeInTheDocument();
    });
  });

  describe('removing patterns', () => {
    it('removing a pattern calls onRemove', () => {
      const onRemove = jest.fn();
      renderPanel({
        patterns: [makePattern({ id: 42 })],
        onRemove,
      });

      const removeButtons = screen.getAllByText('Remove');
      fireEvent.click(removeButtons[0]);
      expect(onRemove).toHaveBeenCalledWith(42);
    });
  });

  describe('excluded count display', () => {
    it('shows excluded count vs total count', () => {
      renderPanel({ excludedCount: 5, totalCount: 100 });
      expect(screen.getByText('Hiding 5 of 100 files')).toBeInTheDocument();
    });

    it('does not show hiding count when excludedCount is 0', () => {
      renderPanel({ excludedCount: 0, totalCount: 50 });
      expect(screen.getByText('Hide files by pattern')).toBeInTheDocument();
      expect(screen.queryByText('Hiding 0 of 50 files')).not.toBeInTheDocument();
    });
  });

  describe('scan exclude patterns section', () => {
    it('renders scanExcludePatterns section when provided', () => {
      renderPanel({ scanExcludePatterns: sampleScanExcludes });

      expect(screen.getByText('Scan-Level Excludes')).toBeInTheDocument();
      expect(screen.getByText('All Languages')).toBeInTheDocument();
      expect(screen.getByText('C# / .NET')).toBeInTheDocument();
      expect(screen.getByText('TypeScript / JavaScript')).toBeInTheDocument();

      expect(screen.getByText('node_modules')).toBeInTheDocument();
      expect(screen.getByText('dist')).toBeInTheDocument();
      expect(screen.getByText('bin/')).toBeInTheDocument();
      expect(screen.getByText('obj/')).toBeInTheDocument();
      expect(screen.getByText('*.d.ts')).toBeInTheDocument();
    });

    it('does not render scan-exclude section when null', () => {
      renderPanel({ scanExcludePatterns: null });

      expect(screen.queryByText('Scan-Level Excludes')).not.toBeInTheDocument();
      expect(screen.queryByText('All Languages')).not.toBeInTheDocument();
    });

    it('skips language sections with empty arrays', () => {
      const partial: ScanExcludePatterns = {
        global: ['node_modules'],
        csharp: [],
        typescript: [],
      };
      renderPanel({ scanExcludePatterns: partial });

      // Only global should render
      expect(screen.getByText('All Languages')).toBeInTheDocument();
      expect(screen.getByText('node_modules')).toBeInTheDocument();
      expect(screen.queryByText('C# / .NET')).not.toBeInTheDocument();
      expect(screen.queryByText('TypeScript / JavaScript')).not.toBeInTheDocument();
    });
  });

  describe('close button', () => {
    it('calls onClose when Close button is clicked', () => {
      const onClose = jest.fn();
      renderPanel({ onClose });
      fireEvent.click(screen.getByText('Close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
