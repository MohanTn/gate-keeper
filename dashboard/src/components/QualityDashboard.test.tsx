import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QualityDashboard } from './QualityDashboard';
import { darkTokens } from '../ThemeContext';
import '@testing-library/jest-dom';

const T = darkTokens;

// ── Mock child components ───────────────────────────────────────────────────

jest.mock('./QualityProgressCard', () => ({
  QualityProgressCard: (props: { running: boolean; paused: boolean }) => (
    <div data-testid="quality-progress-card">
      {props.running ? 'running' : 'stopped'}
      {props.paused ? '-paused' : ''}
    </div>
  ),
}));

jest.mock('./QualityTrendChart', () => ({
  QualityTrendChart: () => <div data-testid="quality-trend-chart" />,
}));

jest.mock('./QualityQueuePanel', () => ({
  QualityQueuePanel: () => <div data-testid="quality-queue-panel" />,
}));

// ── Mock useQualityWebSocket ────────────────────────────────────────────────

const mockWsState = {
  stats: null as null | { total: number; completed: number; inProgress: number; pending: number; failed: number; skipped: number },
  items: [] as unknown[],
  trends: [] as unknown[],
  overallRating: 10,
  running: false,
  paused: false,
};

jest.mock('../hooks/useQualityWebSocket', () => ({
  useQualityWebSocket: () => mockWsState,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function resetMockState() {
  mockWsState.stats = null;
  mockWsState.items = [];
  mockWsState.trends = [];
  mockWsState.overallRating = 10;
  mockWsState.running = false;
  mockWsState.paused = false;
}

beforeEach(() => {
  resetMockState();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('QualityDashboard', () => {
  describe('action buttons', () => {
    it('renders Start button when not running', () => {
      render(<QualityDashboard T={T} />);
      expect(screen.getByText('Start')).toBeInTheDocument();
    });

    it('renders Stop button when running', () => {
      mockWsState.running = true;
      render(<QualityDashboard T={T} />);
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    it('renders Pause button when running and not paused', () => {
      mockWsState.running = true;
      mockWsState.paused = false;
      render(<QualityDashboard T={T} />);
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    it('renders Resume button when running and paused', () => {
      mockWsState.running = true;
      mockWsState.paused = true;
      render(<QualityDashboard T={T} />);
      expect(screen.getByText('Resume')).toBeInTheDocument();
    });

    it('does not render Pause/Resume when not running', () => {
      mockWsState.running = false;
      render(<QualityDashboard T={T} />);
      expect(screen.queryByText('Pause')).not.toBeInTheDocument();
      expect(screen.queryByText('Resume')).not.toBeInTheDocument();
    });

    it('always renders Reset Failed button', () => {
      render(<QualityDashboard T={T} />);
      expect(screen.getByText('Reset Failed')).toBeInTheDocument();
    });

    it('always shows concurrency info', () => {
      render(<QualityDashboard T={T} />);
      expect(screen.getByText(/Max workers: 2/i)).toBeInTheDocument();
    });
  });

  describe('button click handlers', () => {
    it('Start button calls multiple fetch endpoints', async () => {
      render(<QualityDashboard T={T} />);

      await Promise.resolve(); // flush microtasks
      fireEvent.click(screen.getByText('Start'));
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/quality/config'), expect.any(Object),
      );
    });

    it('Stop button calls stop endpoint', async () => {
      mockWsState.running = true;
      render(<QualityDashboard T={T} />);

      fireEvent.click(screen.getByText('Stop'));
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:5379/api/quality/stop', { method: 'POST' },
      );
    });

    it('Pause button calls pause endpoint', async () => {
      mockWsState.running = true;
      mockWsState.paused = false;
      render(<QualityDashboard T={T} />);

      fireEvent.click(screen.getByText('Pause'));
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:5379/api/quality/pause', { method: 'POST' },
      );
    });

    it('Resume button calls resume endpoint', async () => {
      mockWsState.running = true;
      mockWsState.paused = true;
      render(<QualityDashboard T={T} />);

      fireEvent.click(screen.getByText('Resume'));
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:5379/api/quality/resume', { method: 'POST' },
      );
    });

    it('Reset Failed button calls reset endpoint', async () => {
      render(<QualityDashboard T={T} />);

      fireEvent.click(screen.getByText('Reset Failed'));
      await Promise.resolve();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:5379/api/quality/reset', { method: 'POST' },
      );
    });

    it('handles fetch failure on Start without throwing', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network'));
      render(<QualityDashboard T={T} />);

      expect(() => fireEvent.click(screen.getByText('Start'))).not.toThrow();
    });
  });

  describe('child components', () => {
    it('renders QualityProgressCard', () => {
      render(<QualityDashboard T={T} />);
      expect(screen.getByTestId('quality-progress-card')).toBeInTheDocument();
    });

    it('renders QualityTrendChart', () => {
      render(<QualityDashboard T={T} />);
      expect(screen.getByTestId('quality-trend-chart')).toBeInTheDocument();
    });

    it('renders QualityQueuePanel', () => {
      render(<QualityDashboard T={T} />);
      expect(screen.getByTestId('quality-queue-panel')).toBeInTheDocument();
    });

    it('passes running state to progress card', () => {
      mockWsState.running = true;
      render(<QualityDashboard T={T} />);
      expect(screen.getByTestId('quality-progress-card')).toHaveTextContent('running');
    });
  });
});
