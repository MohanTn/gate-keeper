import { renderHook, act, waitFor } from '@testing-library/react';
import { useAttemptHistory } from './useAttemptHistory';
import { AttemptLog } from '../types';

function mockOkResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response);
}

function mockFailResponse() {
  return Promise.resolve({ ok: false } as Response);
}

const sampleAttempts: AttemptLog[] = [
  {
    id: 1, queue_id: 42, attempt: 1,
    rating_before: 5.0, rating_after: 6.5,
    violations_fixed: 3, violations_remaining: 2,
    fix_summary: 'Fixed three issues', error_message: null,
    duration_ms: 12000, worker_output: 'done', created_at: Date.now(),
  },
  {
    id: 2, queue_id: 42, attempt: 2,
    rating_before: 6.5, rating_after: 7.5,
    violations_fixed: 2, violations_remaining: 0,
    fix_summary: 'All fixed', error_message: null,
    duration_ms: 8000, worker_output: null, created_at: Date.now(),
  },
];

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useAttemptHistory', () => {
  it('returns correct initial state', () => {
    const { result } = renderHook(() => useAttemptHistory());

    expect(result.current.attempts).toEqual({});
    expect(result.current.loadingAttempts).toEqual(new Set());
    expect(result.current.expandedId).toBeNull();
    expect(typeof result.current.loadAttempts).toBe('function');
  });

  it('fetches attempts from API when item not yet loaded', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockOkResponse(sampleAttempts));

    const { result } = renderHook(() => useAttemptHistory());

    await act(async () => {
      await result.current.loadAttempts(42);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5379/api/quality/attempts/42',
    );
    expect(result.current.attempts[42]).toEqual(sampleAttempts);
    expect(result.current.expandedId).toBe(42);
  });

  it('sets loading state while fetching', async () => {
    let resolvePromise!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { resolvePromise = resolve; });
    (global.fetch as jest.Mock).mockReturnValueOnce(pending);

    const { result } = renderHook(() => useAttemptHistory());

    // Start the load without awaiting
    act(() => { void result.current.loadAttempts(7); });

    // Loading should be true mid-fetch
    expect(result.current.loadingAttempts.has(7)).toBe(true);

    // Resolve the fetch
    await act(async () => {
      resolvePromise(mockOkResponse([]) as unknown as Response);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(result.current.loadingAttempts.has(7)).toBe(false);
  });

  it('toggles collapse when item already loaded', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockOkResponse(sampleAttempts));

    const { result } = renderHook(() => useAttemptHistory());

    // First load — expands item 42
    await act(async () => { await result.current.loadAttempts(42); });
    expect(result.current.expandedId).toBe(42);

    // Second call — collapses (toggles to null)
    await act(async () => { await result.current.loadAttempts(42); });
    expect(result.current.expandedId).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1); // no second fetch
  });

  it('re-expands a collapsed item without fetching again', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockOkResponse(sampleAttempts));

    const { result } = renderHook(() => useAttemptHistory());

    await act(async () => { await result.current.loadAttempts(42); });
    await act(async () => { await result.current.loadAttempts(42); }); // collapse
    await act(async () => { await result.current.loadAttempts(42); }); // expand again

    expect(global.fetch).toHaveBeenCalledTimes(1); // still just the first fetch
    expect(result.current.expandedId).toBe(42);
  });

  it('handles non-ok response gracefully (no state update)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFailResponse());

    const { result } = renderHook(() => useAttemptHistory());

    await act(async () => { await result.current.loadAttempts(99); });

    expect(result.current.attempts[99]).toBeUndefined();
    expect(result.current.expandedId).toBe(99);
    expect(result.current.loadingAttempts.has(99)).toBe(false);
  });

  it('handles fetch network error gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAttemptHistory());

    await act(async () => { await result.current.loadAttempts(5); });

    expect(result.current.attempts[5]).toBeUndefined();
    expect(result.current.loadingAttempts.has(5)).toBe(false);
  });

  it('can load multiple different items independently', async () => {
    const attempts10: AttemptLog[] = [{ ...sampleAttempts[0]!, id: 10, queue_id: 10 }];
    const attempts20: AttemptLog[] = [{ ...sampleAttempts[0]!, id: 20, queue_id: 20 }];

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockOkResponse(attempts10))
      .mockResolvedValueOnce(mockOkResponse(attempts20));

    const { result } = renderHook(() => useAttemptHistory());

    await act(async () => { await result.current.loadAttempts(10); });
    await act(async () => { await result.current.loadAttempts(20); });

    expect(result.current.attempts[10]).toEqual(attempts10);
    expect(result.current.attempts[20]).toEqual(attempts20);
    expect(result.current.expandedId).toBe(20);
  });

  it('stores empty array for item with no attempts', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockOkResponse([]));

    const { result } = renderHook(() => useAttemptHistory());

    await act(async () => { await result.current.loadAttempts(1); });

    expect(result.current.attempts[1]).toEqual([]);
  });
});
