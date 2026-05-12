import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QualityQueuePanel } from './QualityQueuePanel';
import { QueueItem, AttemptLog } from '../types';
import { darkTokens, ThemeTokens } from '../ThemeContext';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRepos = jest.fn().mockReturnValue({});
const mockWorkerState = {
  executingWorkers: {} as Record<number, string>,
  terminalOutputs: {} as Record<number, { output: string; running: boolean; exitCode: number | null }>,
  handleExecute: jest.fn(),
  handleCancel: jest.fn(),
  clearWorkerState: jest.fn(),
};
const mockAttemptState = {
  attempts: {} as Record<number, AttemptLog[]>,
  loadingAttempts: new Set<number>(),
  expandedId: null as number | null,
  loadAttempts: jest.fn(),
};

jest.mock('../hooks/useRepoSessions', () => ({
  useRepoSessions: () => mockRepos(),
}));

jest.mock('../hooks/useWorkerExecution', () => ({
  useWorkerExecution: () => mockWorkerState,
}));

jest.mock('../hooks/useAttemptHistory', () => ({
  useAttemptHistory: () => mockAttemptState,
}));

// ── Theme ─────────────────────────────────────────────────────────────────────

const T: ThemeTokens = darkTokens;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 1,
    repo: '/repo',
    filePath: '/repo/src/file.ts',
    currentRating: 5.0,
    targetRating: 8.0,
    priorityScore: 10,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    workerId: null,
    lockedAt: null,
    errorMessage: null,
    completedAt: null,
    createdAt: 1000,
    ...overrides,
  };
}

function renderPanel(items: QueueItem[] = []) {
  return render(<QualityQueuePanel items={items} T={T} />);
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkerState.executingWorkers = {};
  mockWorkerState.terminalOutputs = {};
  mockAttemptState.attempts = {};
  mockAttemptState.loadingAttempts = new Set();
  mockAttemptState.expandedId = null;
});

describe('QualityQueuePanel', () => {
  describe('rendering', () => {
    it('shows empty state when no items', () => {
      renderPanel();
      expect(screen.getByText('Queue (0)')).toBeInTheDocument();
      expect(screen.getByText('No items')).toBeInTheDocument();
    });

    it('renders queue items', () => {
      renderPanel([makeItem()]);
      expect(screen.getByText('Queue (1)')).toBeInTheDocument();
      expect(screen.getByText('#1')).toBeInTheDocument();
    });

    it('displays the relative file path', () => {
      renderPanel([makeItem({ filePath: '/repo/src/components/App.tsx' })]);
      expect(screen.getByText('src/components/App.tsx')).toBeInTheDocument();
    });

    it('shows rating with target', () => {
      renderPanel([makeItem({ currentRating: 5.5 })]);
      expect(screen.getByText('5.5')).toBeInTheDocument();
      expect(screen.getByText('/8.0')).toBeInTheDocument();
    });

    it('shows attempt count out of maxAttempts', () => {
      renderPanel([makeItem({ attempts: 2, maxAttempts: 5 })]);
      expect(screen.getByText('2/5')).toBeInTheDocument();
    });
  });

  describe('status badges', () => {
    it.each([
      ['pending', 'pending', 'Pending'],
      ['in_progress', 'in_progress', 'In Progress'],
      ['completed', 'completed', 'Completed'],
      ['failed', 'failed', 'Failed'],
      ['skipped', 'skipped', 'Skipped'],
    ] as const)('shows "%s" badge for %s status', (_label, status, expectedText) => {
      renderPanel([makeItem({ status })]);
      expect(screen.getByText(expectedText)).toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('shows "all" filter active by default', () => {
      renderPanel([makeItem({ status: 'pending' }), makeItem({ id: 2, status: 'completed' })]);
      expect(screen.getByText('Queue (2)')).toBeInTheDocument();
      // Both items visible by default
      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.getByText('#2')).toBeInTheDocument();
    });

    it('filters items when a status filter is clicked', () => {
      renderPanel([
        makeItem({ id: 1, status: 'pending' }),
        makeItem({ id: 2, status: 'completed' }),
      ]);

      fireEvent.click(screen.getByText('pending'));

      expect(screen.getByText('#1')).toBeInTheDocument();
      expect(screen.queryByText('#2')).not.toBeInTheDocument();
    });

    it('shows no items when filter matches nothing', () => {
      renderPanel([makeItem({ status: 'pending' })]);
      fireEvent.click(screen.getByText('failed'));
      expect(screen.getByText('No items')).toBeInTheDocument();
    });
  });

  describe('action buttons', () => {
    it('shows Execute and Delete for pending items', () => {
      renderPanel([makeItem({ status: 'pending' })]);
      expect(screen.getByText('Execute')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('does not show Execute for in_progress items', () => {
      renderPanel([makeItem({ status: 'in_progress' })]);
      expect(screen.queryByText('Execute')).not.toBeInTheDocument();
    });

    it('does not show Execute/Cancel for completed items', () => {
      renderPanel([makeItem({ status: 'completed' })]);
      expect(screen.queryByText('Execute')).not.toBeInTheDocument();
      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });

    it('shows Delete for completed items', () => {
      renderPanel([makeItem({ status: 'completed' })]);
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('calls handleExecute when Execute is clicked', () => {
      renderPanel([makeItem({ id: 5, status: 'pending' })]);
      fireEvent.click(screen.getByText('Execute'));
      expect(mockWorkerState.handleExecute).toHaveBeenCalledWith(5);
    });

    it('shows Cancel button when item is executing', () => {
      mockWorkerState.executingWorkers = { 1: 'w1' };
      renderPanel([makeItem({ id: 1, status: 'in_progress' })]);
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('calls handleCancel when Cancel is clicked', () => {
      mockWorkerState.executingWorkers = { 5: 'w1' };
      renderPanel([makeItem({ id: 5, status: 'in_progress' })]);
      fireEvent.click(screen.getByText('Cancel'));
      expect(mockWorkerState.handleCancel).toHaveBeenCalledWith(5);
    });
  });

  describe('row expansion', () => {
    it('calls loadAttempts when a pending row is clicked', () => {
      renderPanel([makeItem({ id: 3 })]);
      fireEvent.click(screen.getByText('#3'));
      expect(mockAttemptState.loadAttempts).toHaveBeenCalledWith(3);
    });

    it('does not call loadAttempts when an executing row is clicked', () => {
      mockWorkerState.executingWorkers = { 1: 'w1' };
      renderPanel([makeItem({ id: 1 })]);
      fireEvent.click(screen.getByText('#1'));
      expect(mockAttemptState.loadAttempts).not.toHaveBeenCalled();
    });

    it('shows attempt history when expanded with data', () => {
      const attempt: AttemptLog = {
        id: 10,
        queue_id: 1,
        attempt: 1,
        rating_before: 5.0,
        rating_after: 7.5,
        violations_fixed: 3,
        violations_remaining: 1,
        fix_summary: 'Fixed some issues',
        error_message: null,
        duration_ms: 45000,
        worker_output: 'output text',
        created_at: 2000,
      };
      mockAttemptState.attempts = { 1: [attempt] };
      mockAttemptState.expandedId = 1;

      renderPanel([makeItem({ id: 1 })]);
      expect(screen.getByText('Attempt History')).toBeInTheDocument();
      expect(screen.getByText(/5\.0 → 7\.5/)).toBeInTheDocument();
      expect(screen.getByText(/3 fixed/)).toBeInTheDocument();
      expect(screen.getByText(/1 remaining/)).toBeInTheDocument();
    });

    it('shows worker output in attempt history', () => {
      const attempt: AttemptLog = {
        id: 10, queue_id: 1, attempt: 1,
        rating_before: 5, rating_after: 7,
        violations_fixed: 3, violations_remaining: 1,
        fix_summary: null, error_message: null,
        duration_ms: null, worker_output: 'Fixed violations in file.ts',
        created_at: 2000,
      };
      mockAttemptState.attempts = { 1: [attempt] };
      mockAttemptState.expandedId = 1;

      renderPanel([makeItem({ id: 1 })]);
      expect(screen.getByText('Fixed violations in file.ts')).toBeInTheDocument();
    });

    it('shows loading indicator when fetching attempts', () => {
      mockAttemptState.loadingAttempts = new Set([1]);
      mockAttemptState.expandedId = 1;

      renderPanel([makeItem({ id: 1 })]);
      expect(screen.getByText('Loading attempt log...')).toBeInTheDocument();
    });
  });

  describe('terminal output', () => {
    it('displays terminal output for executing items', () => {
      mockWorkerState.terminalOutputs = {
        1: { output: 'Building...\nDone!', running: false, exitCode: 0 },
      };
      mockAttemptState.expandedId = 1;

      renderPanel([makeItem({ id: 1 })]);
      expect(screen.getByText('Terminal Output')).toBeInTheDocument();
      expect(screen.getByText(/Building/)).toBeInTheDocument();
      expect(screen.getByText(/Done!/)).toBeInTheDocument();
      expect(screen.getByText(/Exit code: 0/)).toBeInTheDocument();
    });

    it('shows running indicator when terminal is active', () => {
      mockWorkerState.terminalOutputs = {
        1: { output: 'Working...', running: true, exitCode: null },
      };
      mockAttemptState.expandedId = 1;

      renderPanel([makeItem({ id: 1 })]);
      expect(screen.getByText('Running...')).toBeInTheDocument();
    });

    it('shows exit code for completed terminal', () => {
      mockWorkerState.terminalOutputs = {
        1: { output: '', running: false, exitCode: 1 },
      };
      mockAttemptState.expandedId = 1;

      renderPanel([makeItem({ id: 1 })]);
      expect(screen.getByText(/Exit code: 1/)).toBeInTheDocument();
    });

  });

  describe('error display', () => {
    it('shows error message for failed items', () => {
      mockAttemptState.expandedId = 2;
      renderPanel([makeItem({
        id: 2,
        status: 'failed',
        errorMessage: 'Analysis timeout',
      })]);
      expect(screen.getByText(/Error: Analysis timeout/)).toBeInTheDocument();
    });
  });

  describe('session type display', () => {
    it('shows claude for unknown session type', () => {
      renderPanel([makeItem({ repo: '/unknown-repo' })]);
      expect(screen.getByText('claude')).toBeInTheDocument();
    });

    it('shows copilot for github-copilot session type', () => {
      mockRepos.mockReturnValue({ '/repo': 'github-copilot' });
      renderPanel([makeItem()]);
      expect(screen.getByText('copilot')).toBeInTheDocument();
    });
  });

  describe('action button stopPropagation', () => {
    it('Execute button click does not trigger row click', () => {
      const executeSpy = mockWorkerState.handleExecute;
      const loadSpy = mockAttemptState.loadAttempts;

      renderPanel([makeItem({ id: 7, status: 'pending' })]);
      fireEvent.click(screen.getByText('Execute'));

      expect(executeSpy).toHaveBeenCalled();
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('Delete button click does not trigger row click', () => {
      const loadSpy = mockAttemptState.loadAttempts;

      renderPanel([makeItem({ id: 8 })]);
      fireEvent.click(screen.getByText('Delete'));

      expect(loadSpy).not.toHaveBeenCalled();
    });
  });
});
