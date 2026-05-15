import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QualityQueuePanel } from './QualityQueuePanel';
import { darkTokens } from '../ThemeContext';
import { QueueItem } from '../types';
import '@testing-library/jest-dom';

const T = darkTokens;

// ── Mock hooks ──────────────────────────────────────────────────────────────

const mockHandleExecute = jest.fn();
const mockHandleCancel = jest.fn();
const mockClearWorkerState = jest.fn();
const mockLoadAttempts = jest.fn();

jest.mock('../hooks/useRepoSessions', () => ({
  useRepoSessions: () => ({ '/repo/project': 'claude' }),
}));

jest.mock('../hooks/useWorkerExecution', () => ({
  useWorkerExecution: () => ({
    executingWorkers: {},
    terminalOutputs: {},
    handleExecute: mockHandleExecute,
    handleCancel: mockHandleCancel,
    clearWorkerState: mockClearWorkerState,
  }),
}));

jest.mock('../hooks/useAttemptHistory', () => ({
  useAttemptHistory: () => ({
    attempts: {},
    loadingAttempts: new Set(),
    expandedId: null,
    loadAttempts: mockLoadAttempts,
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 1,
    repo: '/repo/project',
    filePath: '/repo/project/src/App.ts',
    currentRating: 5.5,
    targetRating: 8.0,
    priorityScore: 0.7,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    workerId: null,
    lockedAt: null,
    errorMessage: null,
    completedAt: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('QualityQueuePanel', () => {
  describe('header', () => {
    it('shows queue count in header', () => {
      render(<QualityQueuePanel items={[makeItem(), makeItem({ id: 2 })]} T={T} />);
      expect(screen.getByText('Queue (2)')).toBeInTheDocument();
    });

    it('shows Queue (0) for empty items', () => {
      render(<QualityQueuePanel items={[]} T={T} />);
      expect(screen.getByText('Queue (0)')).toBeInTheDocument();
    });
  });

  describe('filter buttons', () => {
    it('renders all filter buttons', () => {
      render(<QualityQueuePanel items={[]} T={T} />);
      expect(screen.getByText('all')).toBeInTheDocument();
      expect(screen.getByText('pending')).toBeInTheDocument();
      expect(screen.getByText('in progress')).toBeInTheDocument();
      expect(screen.getByText('completed')).toBeInTheDocument();
      expect(screen.getByText('failed')).toBeInTheDocument();
      expect(screen.getByText('skipped')).toBeInTheDocument();
    });

    it('filters to show only pending items', () => {
      const items = [
        makeItem({ id: 1, status: 'pending' }),
        makeItem({ id: 2, status: 'completed' }),
        makeItem({ id: 3, status: 'pending' }),
      ];
      render(<QualityQueuePanel items={items} T={T} />);

      fireEvent.click(screen.getByText('pending'));

      // 2 pending rows visible (#1 and #3)
      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.getByText('#3')).toBeInTheDocument();
      expect(screen.queryByText('#2')).not.toBeInTheDocument();
    });

    it('all filter shows everything', () => {
      const items = [
        makeItem({ id: 1, status: 'pending' }),
        makeItem({ id: 2, status: 'completed' }),
      ];
      render(<QualityQueuePanel items={items} T={T} />);

      fireEvent.click(screen.getByText('all'));

      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.getByText('#2')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows "No items" message when no filtered items', () => {
      render(<QualityQueuePanel items={[]} T={T} />);
      expect(screen.getByText('No items')).toBeInTheDocument();
    });

    it('shows No items when filter yields empty list', () => {
      const items = [makeItem({ id: 1, status: 'pending' })];
      render(<QualityQueuePanel items={items} T={T} />);

      fireEvent.click(screen.getByText('completed'));

      expect(screen.getByText('No items')).toBeInTheDocument();
    });
  });

  describe('table rendering', () => {
    it('renders column headers when items exist', () => {
      render(<QualityQueuePanel items={[makeItem()]} T={T} />);
      expect(screen.getByText('ID')).toBeInTheDocument();
      expect(screen.getByText('File')).toBeInTheDocument();
      expect(screen.getByText('Command')).toBeInTheDocument();
      expect(screen.getByText('Rating')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Attempts')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('renders item ID with # prefix', () => {
      render(<QualityQueuePanel items={[makeItem({ id: 7 })]} T={T} />);
      expect(screen.getByText('#7')).toBeInTheDocument();
    });

    it('renders rating values', () => {
      render(<QualityQueuePanel items={[makeItem({ currentRating: 5.5, targetRating: 8.0 })]} T={T} />);
      expect(screen.getByText('5.5')).toBeInTheDocument();
      expect(screen.getByText('/8.0')).toBeInTheDocument();
    });

    it('renders attempts count', () => {
      render(<QualityQueuePanel items={[makeItem({ attempts: 2, maxAttempts: 3 })]} T={T} />);
      expect(screen.getByText('2/3')).toBeInTheDocument();
    });

    it('renders status badge', () => {
      render(<QualityQueuePanel items={[makeItem({ status: 'pending' })]} T={T} />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('renders in_progress status badge', () => {
      render(<QualityQueuePanel items={[makeItem({ status: 'in_progress' })]} T={T} />);
      expect(screen.getByText('In Progress')).toBeInTheDocument();
    });

    it('renders completed status badge', () => {
      render(<QualityQueuePanel items={[makeItem({ status: 'completed' })]} T={T} />);
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('shows shortened file path (removes repo prefix)', () => {
      render(<QualityQueuePanel items={[makeItem()]} T={T} />);
      expect(screen.getByText('src/App.ts')).toBeInTheDocument();
    });
  });

  describe('action buttons', () => {
    it('shows Execute button for pending items', () => {
      render(<QualityQueuePanel items={[makeItem({ status: 'pending' })]} T={T} />);
      expect(screen.getByText('Execute')).toBeInTheDocument();
    });

    it('does not show Execute for completed items', () => {
      render(<QualityQueuePanel items={[makeItem({ status: 'completed' })]} T={T} />);
      expect(screen.queryByText('Execute')).not.toBeInTheDocument();
    });

    it('shows Delete button always', () => {
      render(<QualityQueuePanel items={[makeItem()]} T={T} />);
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('calls handleExecute when Execute is clicked', () => {
      render(<QualityQueuePanel items={[makeItem({ id: 5, status: 'pending' })]} T={T} />);
      fireEvent.click(screen.getByText('Execute'));
      expect(mockHandleExecute).toHaveBeenCalledWith(5);
    });

    it('Delete calls fetch and clearWorkerState', async () => {
      render(<QualityQueuePanel items={[makeItem({ id: 3 })]} T={T} />);
      fireEvent.click(screen.getByText('Delete'));
      expect(mockClearWorkerState).toHaveBeenCalledWith(3);
      await Promise.resolve();
      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:5379/api/quality/queue/3/delete', { method: 'POST' },
      );
    });

    it('row click calls loadAttempts', () => {
      render(<QualityQueuePanel items={[makeItem({ id: 9, status: 'pending' })]} T={T} />);
      // Click on the ID cell text which is inside the row
      fireEvent.click(screen.getByText('#9'));
      expect(mockLoadAttempts).toHaveBeenCalledWith(9);
    });
  });

  describe('session type display', () => {
    it('shows claude for non-copilot repos', () => {
      render(<QualityQueuePanel items={[makeItem()]} T={T} />);
      expect(screen.getByText('claude')).toBeInTheDocument();
    });
  });

  describe('multiple items', () => {
    it('renders multiple rows', () => {
      const items = [
        makeItem({ id: 1, status: 'pending' }),
        makeItem({ id: 2, status: 'completed' }),
        makeItem({ id: 3, status: 'failed' }),
      ];
      render(<QualityQueuePanel items={items} T={T} />);
      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.getByText('#2')).toBeInTheDocument();
      expect(screen.getByText('#3')).toBeInTheDocument();
    });
  });
});
