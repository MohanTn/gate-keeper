import { renderHook, act } from '@testing-library/react';
import { useClearData } from './useClearData';
import { RepoInfo } from '../types';

function mockFetchResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  } as Response);
}

const repos: RepoInfo[] = [
  { repoRoot: '/project/my-app', label: 'My App', fileCount: 50 },
  { repoRoot: '/project/other', label: null as unknown as string, fileCount: 10 },
];

beforeEach(() => {
  global.fetch = jest.fn();
  window.confirm = jest.fn();
  window.alert = jest.fn();
  // Mock location.reload
  Object.defineProperty(window, 'location', {
    value: { reload: jest.fn() },
    writable: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useClearData', () => {
  it('alerts when no repo is selected', async () => {
    const { result } = renderHook(() => useClearData(null, repos));

    await act(async () => {
      await result.current();
    });

    expect(window.alert).toHaveBeenCalledWith('Please select a repository first');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('confirms before clearing', async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({ deleted: 50 }),
    );

    const { result } = renderHook(() => useClearData('/project/my-app', repos));

    await act(async () => {
      await result.current();
    });

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete all analysis data for "My App"? This cannot be undone.',
    );
    expect(global.fetch).toHaveBeenCalledWith('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: '/project/my-app' }),
    });
  });

  it('does nothing if cancel is clicked', async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(false);

    const { result } = renderHook(() => useClearData('/project/my-app', repos));

    await act(async () => {
      await result.current();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('alerts and reloads on successful clear', async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({ deleted: 50 }),
    );

    const { result } = renderHook(() => useClearData('/project/my-app', repos));

    await act(async () => {
      await result.current();
    });

    expect(window.alert).toHaveBeenCalledWith('Deleted 50 analyses.');
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('alerts on fetch error', async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useClearData('/project/my-app', repos));

    await act(async () => {
      await result.current();
    });

    expect(window.alert).toHaveBeenCalledWith('Error clearing data');
  });

  it('alerts on non-ok response', async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(true);
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse(null, false),
    );

    const { result } = renderHook(() => useClearData('/project/my-app', repos));

    await act(async () => {
      await result.current();
    });

    expect(window.alert).toHaveBeenCalledWith('Error clearing data');
  });

  it('uses fallback label when repo has no label', async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(false);

    const { result } = renderHook(() => useClearData('/project/other', repos));

    await act(async () => {
      await result.current();
    });

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete all analysis data for "other"? This cannot be undone.',
    );
  });

  it('uses path segment when repo not found in list', async () => {
    (window.confirm as jest.Mock).mockReturnValueOnce(false);

    const { result } = renderHook(() => useClearData('/unknown/repo-path', repos));

    await act(async () => {
      await result.current();
    });

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete all analysis data for "repo-path"? This cannot be undone.',
    );
  });
});
