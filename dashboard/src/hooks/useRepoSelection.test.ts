import { renderHook, act, waitFor } from '@testing-library/react';
import { useRepoSelection } from './useRepoSelection';
import { RepoInfo } from '../types';

function mockFetchResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  } as Response);
}

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useRepoSelection', () => {
  it('returns default initial state', () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse([]));

    const { result } = renderHook(() => useRepoSelection());

    expect(result.current.repos).toEqual([]);
    expect(result.current.selectedRepo).toBeNull();
    expect(result.current.showRepoSelector).toBe(false);
    expect(typeof result.current.handleRepoSelect).toBe('function');
    expect(typeof result.current.handleRepoDelete).toBe('function');
    expect(typeof result.current.refreshRepos).toBe('function');
    expect(typeof result.current.setShowRepoSelector).toBe('function');
  });

  it('loads repos on mount', async () => {
    const repos: RepoInfo[] = [
      { repoRoot: '/path/to/repo', label: 'my-repo', fileCount: 42 },
    ];
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse(repos));

    const { result } = renderHook(() => useRepoSelection());

    await waitFor(() => {
      expect(result.current.repos).toEqual(repos);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/repos');
  });

  it('auto-selects a single repo', async () => {
    const repos: RepoInfo[] = [
      { repoRoot: '/path/to/repo', label: 'my-repo', fileCount: 10 },
    ];
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse(repos));

    const { result } = renderHook(() => useRepoSelection());

    await waitFor(() => {
      expect(result.current.selectedRepo).toBe('/path/to/repo');
    });

    expect(result.current.showRepoSelector).toBe(false);
  });

  it('shows repo selector when multiple repos exist', async () => {
    const repos: RepoInfo[] = [
      { repoRoot: '/a', label: 'repo-a', fileCount: 5 },
      { repoRoot: '/b', label: 'repo-b', fileCount: 3 },
    ];
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse(repos));

    const { result } = renderHook(() => useRepoSelection());

    await waitFor(() => {
      expect(result.current.showRepoSelector).toBe(true);
    });

    expect(result.current.selectedRepo).toBeNull();
    expect(result.current.repos).toHaveLength(2);
  });

  it('handleRepoSelect sets selectedRepo and hides selector', async () => {
    const repos: RepoInfo[] = [
      { repoRoot: '/a', label: 'repo-a', fileCount: 5 },
      { repoRoot: '/b', label: 'repo-b', fileCount: 3 },
    ];
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse(repos));

    const { result } = renderHook(() => useRepoSelection());

    await waitFor(() => {
      expect(result.current.showRepoSelector).toBe(true);
    });

    act(() => {
      result.current.handleRepoSelect('/b');
    });

    expect(result.current.selectedRepo).toBe('/b');
    expect(result.current.showRepoSelector).toBe(false);
  });

  it('handleRepoDelete removes selectedRepo and reloads', async () => {
    const initialRepos: RepoInfo[] = [
      { repoRoot: '/a', label: 'repo-a', fileCount: 5 },
    ];
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse(initialRepos));

    const { result } = renderHook(() => useRepoSelection());

    await waitFor(() => {
      expect(result.current.selectedRepo).toBe('/a');
    });

    // Second fetch for the reload after delete
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse([]));

    act(() => {
      result.current.handleRepoDelete('/a');
    });

    await waitFor(() => {
      expect(result.current.selectedRepo).toBeNull();
    });

    // Should have called fetch twice: initial load + reload
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handleRepoDelete does not clear unrelated selectedRepo', async () => {
    const initialRepos: RepoInfo[] = [
      { repoRoot: '/a', label: 'repo-a', fileCount: 5 },
      { repoRoot: '/b', label: 'repo-b', fileCount: 3 },
    ];
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse(initialRepos));

    const { result } = renderHook(() => useRepoSelection());

    await waitFor(() => {
      expect(result.current.repos).toHaveLength(2);
    });

    act(() => {
      result.current.handleRepoSelect('/a');
    });

    // Reload after delete with same repos (simulating delete of /b)
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchResponse([
      { repoRoot: '/a', label: 'repo-a', fileCount: 5 },
    ]));

    act(() => {
      result.current.handleRepoDelete('/b');
    });

    await waitFor(() => {
      expect(result.current.selectedRepo).toBe('/a');
    });
  });

  it('handles fetch error gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useRepoSelection());

    // Wait a tick for the promise rejection to be handled
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.repos).toEqual([]);
    expect(result.current.selectedRepo).toBeNull();
    expect(result.current.showRepoSelector).toBe(false);
  });
});
