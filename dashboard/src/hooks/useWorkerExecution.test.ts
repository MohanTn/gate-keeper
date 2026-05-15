import { renderHook, act } from '@testing-library/react';
import { useWorkerExecution } from './useWorkerExecution';

function mockFetchJson(data: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(data) } as Response);
}

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useWorkerExecution', () => {
  it('returns correct initial state', () => {
    const { result } = renderHook(() => useWorkerExecution());

    expect(result.current.executingWorkers).toEqual({});
    expect(result.current.terminalOutputs).toEqual({});
    expect(typeof result.current.handleExecute).toBe('function');
    expect(typeof result.current.handleCancel).toBe('function');
    expect(typeof result.current.clearWorkerState).toBe('function');
  });

  it('handleExecute registers worker and starts polling on success', async () => {
    const executeResp = { ok: true, workerId: 'w-abc' };
    const pollResp = { output: 'Starting…', running: true, exitCode: null };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchJson(executeResp))
      .mockResolvedValueOnce(mockFetchJson(pollResp));

    const { result } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(1); });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5379/api/quality/execute/1', { method: 'POST' },
    );
    expect(result.current.executingWorkers[1]).toBe('w-abc');
  });

  it('handleExecute does nothing when API returns ok=false', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockFetchJson({ ok: false, workerId: '' }),
    );

    const { result } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(1); });

    expect(result.current.executingWorkers[1]).toBeUndefined();
  });

  it('handleExecute handles network failure gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network'));

    const { result } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(1); });

    expect(result.current.executingWorkers).toEqual({});
  });

  it('polling updates terminalOutputs', async () => {
    const executeResp = { ok: true, workerId: 'w-xyz' };
    const pollResp1 = { output: 'Line 1', running: true, exitCode: null };
    const pollResp2 = { output: 'Line 1\nLine 2', running: false, exitCode: 0 };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchJson(executeResp))
      .mockResolvedValueOnce(mockFetchJson(pollResp1))  // immediate poll
      .mockResolvedValueOnce(mockFetchJson(pollResp2)); // interval poll

    const { result } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(5); });

    // The immediate poll fires on `startPolling` call; wait for it
    await act(async () => { await Promise.resolve(); });

    expect(result.current.terminalOutputs[5]).toMatchObject({ output: 'Line 1', running: true });

    // Advance timer to trigger the interval poll
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(result.current.terminalOutputs[5]).toMatchObject({ output: 'Line 1\nLine 2', running: false, exitCode: 0 });
  });

  it('clears poll timer when worker finishes', async () => {
    const executeResp = { ok: true, workerId: 'w-done' };
    const pollResp = { output: 'done', running: false, exitCode: 0 };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchJson(executeResp))
      .mockResolvedValue(mockFetchJson(pollResp));

    const { result } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(3); });
    await act(async () => { await Promise.resolve(); });

    // After worker finishes, advancing TERMINAL_KEEP_MS (30s) should clean up executingWorkers
    const fetchCallsBefore = (global.fetch as jest.Mock).mock.calls.length;

    await act(async () => { jest.advanceTimersByTime(31_000); });

    // executingWorkers should be cleared after TERMINAL_KEEP_MS
    expect(result.current.executingWorkers[3]).toBeUndefined();

    // No additional fetches should happen after interval was cleared
    const fetchCallsAfter = (global.fetch as jest.Mock).mock.calls.length;
    expect(fetchCallsAfter).toBe(fetchCallsBefore);
  });

  it('handleCancel posts to cancel endpoint and stops polling', async () => {
    const executeResp = { ok: true, workerId: 'w-cancel' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchJson(executeResp))
      .mockResolvedValue(mockFetchJson({ output: '', running: true, exitCode: null }));

    const { result } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(10); });

    act(() => { result.current.handleCancel(10); });

    await act(async () => { await Promise.resolve(); });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5379/api/quality/cancel/w-cancel', { method: 'POST' },
    );
  });

  it('handleCancel does nothing for unknown itemId', () => {
    const { result } = renderHook(() => useWorkerExecution());

    expect(() => act(() => { result.current.handleCancel(999); })).not.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('clearWorkerState removes worker and terminal output', async () => {
    const executeResp = { ok: true, workerId: 'w-clr' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchJson(executeResp))
      .mockResolvedValue(mockFetchJson({ output: 'x', running: true, exitCode: null }));

    const { result } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(7); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.executingWorkers[7]).toBe('w-clr');

    await act(async () => { result.current.clearWorkerState(7); });

    expect(result.current.executingWorkers[7]).toBeUndefined();
    expect(result.current.terminalOutputs[7]).toBeUndefined();
  });

  it('clearWorkerState on non-executing item does not throw', async () => {
    const { result } = renderHook(() => useWorkerExecution());

    expect(() => act(() => { result.current.clearWorkerState(99); })).not.toThrow();
  });

  it('cleans up timers on unmount', async () => {
    const executeResp = { ok: true, workerId: 'w-unmount' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockFetchJson(executeResp))
      .mockResolvedValue(mockFetchJson({ output: '', running: true, exitCode: null }));

    const { result, unmount } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(2); });

    unmount();

    const callsBefore = (global.fetch as jest.Mock).mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(10_000); });
    const callsAfter = (global.fetch as jest.Mock).mock.calls.length;

    // No additional poll calls should happen after unmount
    expect(callsAfter).toBe(callsBefore);
  });

  it('multiple workers can execute concurrently', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/execute/1')) return mockFetchJson({ ok: true, workerId: 'w-1' });
      if (url.includes('/execute/2')) return mockFetchJson({ ok: true, workerId: 'w-2' });
      return mockFetchJson({ output: '', running: true, exitCode: null });
    });

    const { result } = renderHook(() => useWorkerExecution());

    await act(async () => { await result.current.handleExecute(1); });
    await act(async () => { await result.current.handleExecute(2); });

    expect(result.current.executingWorkers[1]).toBe('w-1');
    expect(result.current.executingWorkers[2]).toBe('w-2');
  });
});
