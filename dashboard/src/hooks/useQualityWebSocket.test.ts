import { renderHook, act, waitFor } from '@testing-library/react';
import { useQualityWebSocket } from './useQualityWebSocket';
import { QueueItem, TrendDataPoint } from '../types';

// ── WebSocket mock ──────────────────────────────────────────────

type WSHandler = (this: WebSocket, ev: Event) => unknown;
type WSMsgHandler = (this: WebSocket, ev: MessageEvent) => unknown;

interface WSInstance {
  onopen: WSHandler | null;
  onclose: WSHandler | null;
  onerror: WSHandler | null;
  onmessage: WSMsgHandler | null;
  send: jest.Mock;
  close: jest.Mock;
  readyState: number;
}

let latestWs: WSInstance | null = null;

function createMockWebSocket(): new (url: string) => Partial<WebSocket> {
  return jest.fn().mockImplementation(() => {
    const instance: WSInstance = {
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send: jest.fn(),
      close: jest.fn().mockImplementation(function (this: WSInstance) {
        if (this.onclose) {
          (this.onclose as (this: WSInstance, ev: Event) => void).call(this, {} as Event);
        }
      }),
      readyState: WebSocket.OPEN,
    };
    latestWs = instance;
    return instance;
  }) as unknown as new (url: string) => Partial<WebSocket>;
}

function simulateWSMessage(msg: Record<string, unknown>) {
  if (!latestWs || !latestWs.onmessage) return;
  (latestWs.onmessage as (ev: MessageEvent) => void).call(
    latestWs as unknown as WebSocket,
    new MessageEvent('message', { data: JSON.stringify(msg) }),
  );
}

// ── Fetch mock ──────────────────────────────────────────────────

function mockFetchResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(data),
  } as Response);
}

// ── Tests ───────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  latestWs = null;
  global.WebSocket = createMockWebSocket() as unknown as typeof WebSocket;
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useQualityWebSocket', () => {
  it('returns default initial state', () => {
    const { result } = renderHook(() => useQualityWebSocket());

    expect(result.current.stats).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(result.current.trends).toEqual([]);
    expect(result.current.overallRating).toBe(10);
    expect(result.current.running).toBe(false);
    expect(result.current.paused).toBe(false);
  });

  it('creates a WebSocket connection on mount', () => {
    renderHook(() => useQualityWebSocket());
    expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost');
  });

  it('handles queue_update: adds a new item', () => {
    const { result } = renderHook(() => useQualityWebSocket());

    const item: QueueItem = {
      id: 1, repo: 'repo', filePath: 'a.ts',
      currentRating: 5, targetRating: 8, priorityScore: 10,
      status: 'pending', attempts: 0, maxAttempts: 3,
      workerId: null, lockedAt: null, errorMessage: null,
      completedAt: null, createdAt: 1000,
    };

    act(() => {
      simulateWSMessage({ type: 'queue_update', queueItem: item });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].id).toBe(1);
  });

  it('handles queue_update: updates an existing item', () => {
    const { result } = renderHook(() => useQualityWebSocket());

    const item: QueueItem = {
      id: 1, repo: 'repo', filePath: 'a.ts',
      currentRating: 5, targetRating: 8, priorityScore: 10,
      status: 'pending', attempts: 0, maxAttempts: 3,
      workerId: null, lockedAt: null, errorMessage: null,
      completedAt: null, createdAt: 1000,
    };

    act(() => {
      simulateWSMessage({ type: 'queue_update', queueItem: item });
    });

    const updated: QueueItem = { ...item, status: 'in_progress' };

    act(() => {
      simulateWSMessage({ type: 'queue_update', queueItem: updated });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].status).toBe('in_progress');
  });

  it('handles queue_progress: updates stats and overallRating', () => {
    const { result } = renderHook(() => useQualityWebSocket());

    act(() => {
      simulateWSMessage({
        type: 'queue_progress',
        queueStats: { total: 10, pending: 3, inProgress: 1, completed: 5, failed: 1, skipped: 0 },
        queueOverallRating: 7.5,
      });
    });

    expect(result.current.stats).toEqual({
      total: 10, pending: 3, inProgress: 1, completed: 5, failed: 1, skipped: 0,
    });
    expect(result.current.overallRating).toBe(7.5);
  });

  it('handles trend_update: appends trend data caped at 100', () => {
    const { result } = renderHook(() => useQualityWebSocket());

    const trend: TrendDataPoint = {
      id: 1, repo: 'repo', overallRating: 7, filesTotal: 10,
      filesPassed: 8, filesFailed: 1, filesPending: 1, recordedAt: 1000,
    };

    act(() => {
      simulateWSMessage({ type: 'trend_update', trend });
    });

    expect(result.current.trends).toHaveLength(1);
    expect(result.current.trends[0].overallRating).toBe(7);
  });

  it('caps trends at 100 entries', () => {
    const { result } = renderHook(() => useQualityWebSocket());

    act(() => {
      for (let i = 0; i < 110; i++) {
        simulateWSMessage({
          type: 'trend_update',
          trend: { id: i, repo: 'repo', overallRating: 7, filesTotal: 10, filesPassed: 8, filesFailed: 1, filesPending: 1, recordedAt: i },
        });
      }
    });

    expect(result.current.trends).toHaveLength(100);
  });

  it('handles worker_activity start: sets running to true', () => {
    const { result } = renderHook(() => useQualityWebSocket());

    act(() => {
      simulateWSMessage({ type: 'worker_activity', workerAction: 'start' });
    });

    expect(result.current.running).toBe(true);
  });

  it('ignores unknown message types', () => {
    const { result } = renderHook(() => useQualityWebSocket());

    act(() => {
      simulateWSMessage({ type: 'unknown_type' });
    });

    expect(result.current.stats).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it('fetches initial state from API after 1s delay', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        mockFetchResponse({ stats: { total: 5, pending: 2, inProgress: 0, completed: 3, failed: 0, skipped: 0 }, running: true, paused: false }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ items: [] }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse([]),
      );

    const { result } = renderHook(() => useQualityWebSocket());

    // Fast-forward past the 1s delay
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.running).toBe(true);
      expect(result.current.stats?.total).toBe(5);
    });

    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5379/api/quality/status');
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5379/api/quality/queue');
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:5379/api/quality/trends');
  });

  it('reconnects after WebSocket close', () => {
    renderHook(() => useQualityWebSocket());

    // Clear the initial call count
    (global.WebSocket as jest.Mock).mockClear();
    jest.clearAllTimers();

    // Simulate close (onclose is already called inside ws.close())
    act(() => {
      if (latestWs && latestWs.onclose) {
        (latestWs.onclose as (ev: Event) => void).call(latestWs as unknown as WebSocket, {} as Event);
      }
    });

    // Advance past the 3s reconnect timer
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(global.WebSocket).toHaveBeenCalledTimes(1);
  });

  it('cleans up WebSocket and timers on unmount', () => {
    const { unmount } = renderHook(() => useQualityWebSocket());
    const ws = latestWs;

    unmount();

    expect(ws?.close).toHaveBeenCalled();
  });
});
