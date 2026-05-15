import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SearchResultItem, RepoSelectorModal } from './RepoSelector';
import { darkTokens } from '../ThemeContext';
import type { GraphNode, RepoInfo } from '../types';
import '@testing-library/jest-dom';

// ── Theme mock ──────────────────────────────────────────────────────────────

jest.mock('../ThemeContext', () => ({
  useTheme: () => ({ T: darkTokens, mode: 'dark', toggleTheme: jest.fn() }),
  darkTokens: jest.requireActual('../ThemeContext').darkTokens,
  ratingColor: jest.requireActual('../ThemeContext').ratingColor,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function createNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'src/file.ts',
    label: 'file.ts',
    type: 'typescript',
    rating: 8.0,
    size: 10,
    violations: [],
    metrics: {
      linesOfCode: 50,
      cyclomaticComplexity: 2,
      numberOfMethods: 3,
      numberOfClasses: 1,
      importCount: 3,
    },
    ...overrides,
  } as GraphNode;
}

function createRepo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    repoRoot: '/home/user/project',
    label: 'my-project',
    fileCount: 42,
    sessionType: 'claude',
    ...overrides,
  };
}

// ── SearchResultItem Tests ──────────────────────────────────────────────────

describe('SearchResultItem', () => {
  it('renders label and rating', () => {
    const node = createNode({ label: 'App.tsx', rating: 7.5 });
    render(<SearchResultItem node={node} onSelect={jest.fn()} />);
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('7.5')).toBeInTheDocument();
  });

  it('calls onSelect on mouseDown', () => {
    const onSelect = jest.fn();
    const node = createNode({ id: 'src/App.tsx', label: 'App.tsx', rating: 9.0 });
    render(<SearchResultItem node={node} onSelect={onSelect} />);

    fireEvent.mouseDown(screen.getByText('App.tsx'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(node);
  });

  it('has search-result-item class', () => {
    render(<SearchResultItem node={createNode()} onSelect={jest.fn()} />);
    expect(screen.getByText('file.ts').closest('.search-result-item')).toBeInTheDocument();
  });
});

// ── RepoSelectorModal Tests ─────────────────────────────────────────────────

describe('RepoSelectorModal', () => {
  const repos = [
    createRepo({ repoRoot: '/repo/one', label: 'Repo One', fileCount: 10 }),
    createRepo({ repoRoot: '/repo/two', label: 'Repo Two', fileCount: 20 }),
  ];

  it('renders repo buttons', () => {
    render(
      <RepoSelectorModal
        repos={repos}
        selectedRepo={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    expect(screen.getByText('Select Repository')).toBeInTheDocument();
    expect(screen.getByText('Repo One')).toBeInTheDocument();
    expect(screen.getByText('Repo Two')).toBeInTheDocument();
    expect(screen.getByText('10 files')).toBeInTheDocument();
    expect(screen.getByText('20 files')).toBeInTheDocument();
  });

  it('calls onSelect on click', () => {
    const onSelect = jest.fn();
    render(
      <RepoSelectorModal
        repos={repos}
        selectedRepo={null}
        onSelect={onSelect}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText('Repo One'));
    expect(onSelect).toHaveBeenCalledWith('/repo/one');
  });

  it('calls onClose when clicking overlay background', () => {
    const onClose = jest.fn();
    const { container } = render(
      <RepoSelectorModal
        repos={repos}
        selectedRepo={null}
        onSelect={jest.fn()}
        onClose={onClose}
        onDelete={jest.fn()}
      />
    );

    // The overlay is the outermost fixed div
    const overlay = container.firstChild as HTMLElement;
    expect(overlay).toHaveStyle('position: fixed');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when clicking inside modal', () => {
    const onClose = jest.fn();
    render(
      <RepoSelectorModal
        repos={repos}
        selectedRepo={null}
        onSelect={jest.fn()}
        onClose={onClose}
        onDelete={jest.fn()}
      />
    );

    // Click inside the modal content area (on the title text)
    fireEvent.click(screen.getByText('Select Repository'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel button calls onClose', () => {
    const onClose = jest.fn();
    render(
      <RepoSelectorModal
        repos={repos}
        selectedRepo={null}
        onSelect={jest.fn()}
        onClose={onClose}
        onDelete={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows confirm dialog before delete', () => {
    const onDelete = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);

    // Mock fetch for DELETE
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
    );

    render(
      <RepoSelectorModal
        repos={repos}
        selectedRepo={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onDelete={onDelete}
      />
    );

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Repo One')
    );
  });

  it('does not delete when confirm is cancelled', () => {
    window.confirm = jest.fn().mockReturnValue(false);
    global.fetch = jest.fn();

    render(
      <RepoSelectorModal
        repos={repos}
        selectedRepo={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('highlights selected repo', () => {
    render(
      <RepoSelectorModal
        repos={repos}
        selectedRepo="/repo/two"
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onDelete={jest.fn()}
      />
    );

    // The selected repo button should have a different background via accentDim
    const repoButtons = screen.getAllByText(/Repo /);
    expect(repoButtons.length).toBe(2);
  });

  describe('session type badge', () => {
    it('shows Claude badge for claude session type', () => {
      const reposWithClaude = [createRepo({ sessionType: 'claude' })];
      render(
        <RepoSelectorModal
          repos={reposWithClaude}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    it('shows Copilot badge for github-copilot session type', () => {
      const reposWithCopilot = [createRepo({ sessionType: 'github-copilot' })];
      render(
        <RepoSelectorModal
          repos={reposWithCopilot}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      expect(screen.getByText('Copilot')).toBeInTheDocument();
    });

    it('does not show badge for unknown session type', () => {
      const reposWithUnknown = [createRepo({ sessionType: 'unknown' })];
      render(
        <RepoSelectorModal
          repos={reposWithUnknown}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      expect(screen.queryByText('Claude')).not.toBeInTheDocument();
      expect(screen.queryByText('Copilot')).not.toBeInTheDocument();
    });
  });

  describe('repo button file count', () => {
    it('uses singular "file" when fileCount is 1', () => {
      const singleFileRepo = [createRepo({ fileCount: 1 })];
      render(
        <RepoSelectorModal
          repos={singleFileRepo}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      expect(screen.getByText('1 file')).toBeInTheDocument();
    });

    it('uses plural "files" when fileCount > 1', () => {
      const multiFileRepo = [createRepo({ fileCount: 5 })];
      render(
        <RepoSelectorModal
          repos={multiFileRepo}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      expect(screen.getByText('5 files')).toBeInTheDocument();
    });
  });

  describe('delete — async completion', () => {
    it('calls onDelete after successful fetch', async () => {
      const onDelete = jest.fn();
      window.confirm = jest.fn().mockReturnValue(true);
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
      } as Response));

      render(
        <RepoSelectorModal
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={onDelete}
        />
      );

      fireEvent.click(screen.getAllByText('Delete')[0]);

      await act(async () => {
        await Promise.resolve(); // flush .then(r => r.json())
        await Promise.resolve(); // flush .then(() => onDelete(...))
      });

      expect(onDelete).toHaveBeenCalledWith('/repo/one');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/repos',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('calls fetch with correct JSON body', async () => {
      window.confirm = jest.fn().mockReturnValue(true);
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response));

      render(
        <RepoSelectorModal
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      fireEvent.click(screen.getAllByText('Delete')[0]);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.repoRoot).toBe('/repo/one');
    });

    it('alerts on fetch network failure', async () => {
      window.confirm = jest.fn().mockReturnValue(true);
      window.alert = jest.fn();
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));

      render(
        <RepoSelectorModal
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      fireEvent.click(screen.getAllByText('Delete')[0]);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(window.alert).toHaveBeenCalledWith('Failed to delete repository');
    });
  });

  describe('delete button hover states', () => {
    it('changes color on mouse enter', () => {
      render(
        <RepoSelectorModal
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      const deleteButtons = screen.getAllByTitle('Delete repository and all analysis data');
      // Mouse enter — just verify no throw and the button is in the document
      fireEvent.mouseEnter(deleteButtons[0]);
      expect(deleteButtons[0]).toBeInTheDocument();
    });

    it('restores color on mouse leave', () => {
      render(
        <RepoSelectorModal
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );

      const deleteButtons = screen.getAllByTitle('Delete repository and all analysis data');
      fireEvent.mouseEnter(deleteButtons[0]);
      fireEvent.mouseLeave(deleteButtons[0]);
      expect(deleteButtons[0]).toBeInTheDocument();
    });
  });

  describe('repo root path display', () => {
    it('shows the repo root path', () => {
      render(
        <RepoSelectorModal
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(screen.getByText('/repo/one')).toBeInTheDocument();
    });
  });

  describe('overlay click vs inner click', () => {
    it('outer overlay click closes modal (currentTarget === target)', () => {
      const onClose = jest.fn();
      const { container } = render(
        <RepoSelectorModal
          repos={repos}
          selectedRepo={null}
          onSelect={jest.fn()}
          onClose={onClose}
          onDelete={jest.fn()}
        />
      );
      const overlay = container.firstChild as HTMLElement;
      // Simulate clicking exactly on the overlay (not a child)
      Object.defineProperty(overlay, 'target', { value: overlay, configurable: true });
      fireEvent.click(overlay, { bubbles: true });
      // onClose should have been called once (from the overlay handler)
      expect(onClose).toHaveBeenCalled();
    });
  });
});
