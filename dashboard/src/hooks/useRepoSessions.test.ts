import { renderHook, act, waitFor } from '@testing-library/react';
import { useRepoSessions } from './useRepoSessions';

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

describe('useRepoSessions', () => {
  it('fetches repos from daemon on mount', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({
        repos: [
          { path: '/home/project/a', sessionType: 'claude' },
          { path: '/home/project/b', sessionType: 'github-copilot' },
        ],
      }),
    );

    const { result } = renderHook(() => useRepoSessions());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5379/repos');
    });
  });

  it('builds session type map correctly', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({
        repos: [
          { path: '/home/project/a', sessionType: 'claude' },
          { path: '/home/project/b', sessionType: 'github-copilot' },
          { path: '/home/project/c', sessionType: 'unknown' },
        ],
      }),
    );

    const { result } = renderHook(() => useRepoSessions());

    await waitFor(() => {
      expect(result.current).toEqual({
        '/home/project/a': 'claude',
        '/home/project/b': 'github-copilot',
        '/home/project/c': 'unknown',
      });
    });
  });

  it('returns empty object when no repos exist', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse({ repos: [] }),
    );

    const { result } = renderHook(() => useRepoSessions());

    await waitFor(() => {
      expect(result.current).toEqual({});
    });
  });

  it('handles fetch failure gracefully (returns empty object)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useRepoSessions());

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current).toEqual({});
  });

  it('handles non-ok response gracefully', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchResponse(null, false),
    );

    const { result } = renderHook(() => useRepoSessions());

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current).toEqual({});
  });

  it('cleanup via cancelled flag on unmount does not set state', async () => {
    let resolvePromise!: (value: unknown) => void;
    const fetchPromise = new Promise<Response>(resolve => {
      resolvePromise = resolve;
    });

    (global.fetch as jest.Mock).mockReturnValueOnce(fetchPromise);

    const { result, unmount } = renderHook(() => useRepoSessions());

    // Unmount before fetch resolves
    unmount();

    // Now resolve the fetch
    await act(async () => {
      resolvePromise(
        mockFetchResponse({
          repos: [{ path: '/test', sessionType: 'claude' }],
        }),
      );
    });

    // After resolution with cancelled=true, state should not have been set
    expect(result.current).toEqual({});
  });
});
