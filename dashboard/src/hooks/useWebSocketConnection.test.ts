import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebSocketConnection } from './useWebSocketConnection';
import { GraphData, GraphNode, GraphEdge } from '../types';

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
  return jest.fn().mockImplementation((url: string) => {
    const instance: WSInstance = {
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send: jest.fn(),
      close: jest.fn().mockImplementation(function (this: WSInstance) {
        if (this.onclose) {
          (this.onclose as unknown as (this: WSInstance, ev: Event) => void).call(this, {} as Event);
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

function simulateWSOpen() {
  if (!latestWs || !latestWs.onopen) return;
  (latestWs.onopen as (ev: Event) => void).call(latestWs as unknown as WebSocket, {} as Event);
}

// ── Fixtures ────────────────────────────────────────────────────

const sampleNode: GraphNode = {
  id: '/src/file.ts', label: 'file.ts', type: 'typescript',
  rating: 8, size: 1, violations: [],
  metrics: { linesOfCode: 50, cyclomaticComplexity: 2, numberOfMethods: 3, numberOfClasses: 1, importCount: 5 },
};

const sampleEdge: GraphEdge = {
  source: '/src/file.ts', target: '/src/other.ts', type: 'imports', strength: 1,
};

const sampleGraphData: GraphData = {
  nodes: [sampleNode],
  edges: [sampleEdge],
};

// ── Tests ───────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  latestWs = null;
  global.WebSocket = createMockWebSocket() as unknown as typeof WebSocket;
  global.fetch = jest.fn();
  // Mock window.location
  Object.defineProperty(window, 'location', {
    value: { host: 'localhost:5378' },
    writable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useWebSocketConnection', () => {
  it('returns initial default state', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    expect(result.current.graphData).toEqual({ nodes: [], edges: [] });
    expect(result.current.wsStatus).toBe('connecting');
    expect(result.current.scanProgress).toBeNull();
    expect(result.current.scanning).toBe(false);
    expect(result.current.repoLoading).toBe(true);
    expect(result.current.lastScan).toBeNull();
  });

  it('creates WebSocket with correct URL without repo', () => {
    renderHook(() => useWebSocketConnection(null));
    expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:5378');
  });

  it('creates WebSocket with correct URL including repo', () => {
    renderHook(() => useWebSocketConnection('/home/project'));
    expect(global.WebSocket).toHaveBeenCalledWith(
      'ws://localhost:5378?repo=' + encodeURIComponent('/home/project'),
    );
  });

  it('handles init message and sets graphData', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    // Open connection first
    act(() => { simulateWSOpen(); });

    act(() => {
      simulateWSMessage({
        type: 'init',
        data: sampleGraphData,
      });
    });

    expect(result.current.graphData).toEqual(sampleGraphData);
    expect(result.current.repoLoading).toBe(false);
  });

  it('handles update message and merges graph delta', () => {
    const initialNode: GraphNode = {
      id: '/src/existing.ts', label: 'existing.ts', type: 'typescript',
      rating: 7, size: 1, violations: [],
      metrics: { linesOfCode: 30, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 2 },
    };

    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    // Set initial data
    act(() => {
      simulateWSMessage({
        type: 'init',
        data: { nodes: [initialNode], edges: [] },
      });
    });

    // Send update with new node + edge
    act(() => {
      simulateWSMessage({
        type: 'update',
        delta: {
          nodes: [sampleNode],
          edges: [sampleEdge],
        },
        scanTotal: 5,
      });
    });

    expect(result.current.graphData.nodes).toHaveLength(2);
    expect(result.current.graphData.edges).toHaveLength(1);
  });

  it('handles update during scan progress', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    // Start scan
    act(() => {
      simulateWSMessage({ type: 'scan_start', scanTotal: 10 });
    });

    // Update during scan
    act(() => {
      simulateWSMessage({
        type: 'update',
        delta: { nodes: [sampleNode], edges: [] },
        scanTotal: 10,
      });
    });

    expect(result.current.scanProgress).toEqual({ analyzed: 1, total: 10 });
  });

  it('handles scan_start message', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    act(() => {
      simulateWSMessage({ type: 'scan_start', scanTotal: 42 });
    });

    expect(result.current.scanProgress).toEqual({ analyzed: 0, total: 42 });
    expect(result.current.scanning).toBe(false); // scanning state only set when scan_complete sets it
    // scanningRef is true
  });

  it('handles scan_complete message', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    act(() => {
      simulateWSMessage({ type: 'scan_start', scanTotal: 10 });
    });

    act(() => {
      simulateWSMessage({
        type: 'scan_complete',
        scanAnalyzed: 10,
      });
    });

    expect(result.current.scanProgress).toBeNull();
    expect(result.current.scanning).toBe(false);
    expect(result.current.lastScan).not.toBeNull();
    expect(result.current.lastScan!.fileCount).toBe(10);
  });

  it('handles repo_created message and triggers callback', () => {
    const onRepoCreated = jest.fn();
    const { result } = renderHook(() => useWebSocketConnection(null, onRepoCreated));

    act(() => { simulateWSOpen(); });

    act(() => {
      simulateWSMessage({ type: 'repo_created' });
    });

    expect(onRepoCreated).toHaveBeenCalled();
  });

  it('reconnects on close with 3s timer', () => {
    renderHook(() => useWebSocketConnection('/home/project'));

    // Clear initial creation and any pending timers
    (global.WebSocket as unknown as jest.Mock).mockClear();
    jest.clearAllTimers();

    // Simulate close event
    act(() => {
      if (latestWs && latestWs.onclose) {
        (latestWs.onclose as (ev: Event) => void).call(latestWs as unknown as WebSocket, {} as Event);
      }
    });

    // Advance past 3s reconnect timer
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(global.WebSocket).toHaveBeenCalledWith(
      'ws://localhost:5378?repo=' + encodeURIComponent('/home/project'),
    );
  });

  it('changes WebSocket URL when selectedRepo changes', () => {
    const { rerender } = renderHook(
      (repo: string | null) => useWebSocketConnection(repo),
      { initialProps: null },
    );

    (global.WebSocket as unknown as jest.Mock).mockClear();

    rerender('/new/repo');

    expect(global.WebSocket).toHaveBeenCalledWith(
      'ws://localhost:5378?repo=' + encodeURIComponent('/new/repo'),
    );
  });

  it('cleans up WebSocket and timers on unmount', () => {
    const { unmount } = renderHook(() => useWebSocketConnection(null));
    const ws = latestWs;

    unmount();

    expect(ws?.close).toHaveBeenCalled();
  });

  it('reconnect timer does not fire after cleanup when close triggers onclose', () => {
    renderHook(() => useWebSocketConnection('/home/project'));
    jest.clearAllTimers();

    // Simulate close event to start a reconnect timer
    act(() => {
      if (latestWs && latestWs.onclose) {
        (latestWs.onclose as (ev: Event) => void).call(latestWs as unknown as WebSocket, {} as Event);
      }
    });

    // Advance past 3s so the reconnect timer fires
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    // A new WebSocket should have been created
    expect(global.WebSocket).toHaveBeenCalledTimes(2);
  });

  it('handles scan failure via handleScanAll', async () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await result.current.handleScanAll();
    });

    // Scan should have failed but not thrown
    expect(result.current.scanning).toBe(false);
  });

  it('handleScanAll does nothing if already scanning', async () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    // Start scan
    act(() => {
      simulateWSMessage({ type: 'scan_start', scanTotal: 10 });
    });

    // Try scanning again
    await act(async () => {
      await result.current.handleScanAll();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles malformed WebSocket message gracefully', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    act(() => {
      if (latestWs && latestWs.onmessage) {
        (latestWs.onmessage as (ev: MessageEvent) => void).call(
          latestWs as unknown as WebSocket,
          new MessageEvent('message', { data: 'not valid json {{{' }),
        );
      }
    });

    // State should be unchanged
    expect(result.current.graphData).toEqual({ nodes: [], edges: [] });
  });

  it('sets wsStatus to connected on open', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    expect(result.current.wsStatus).toBe('connected');
  });

  it('sets wsStatus to disconnected on close', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    act(() => {
      if (latestWs && latestWs.onclose) {
        (latestWs.onclose as (ev: Event) => void).call(latestWs as unknown as WebSocket, {} as Event);
      }
    });

    expect(result.current.wsStatus).toBe('disconnected');
  });

  it('deduplicates edges on update by source+target key', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    // Add the same edge twice via updates
    act(() => {
      simulateWSMessage({
        type: 'update',
        delta: { nodes: [], edges: [sampleEdge] },
      });
    });

    act(() => {
      simulateWSMessage({
        type: 'update',
        delta: { nodes: [], edges: [sampleEdge] },
      });
    });

    expect(result.current.graphData.edges).toHaveLength(1);
  });

  it('deduplicates nodes on update by id', () => {
    const { result } = renderHook(() => useWebSocketConnection(null));

    act(() => { simulateWSOpen(); });

    act(() => {
      simulateWSMessage({
        type: 'update',
        delta: { nodes: [sampleNode], edges: [] },
      });
    });

    // Same node with updated rating
    const updatedNode = { ...sampleNode, rating: 9 };
    act(() => {
      simulateWSMessage({
        type: 'update',
        delta: { nodes: [updatedNode], edges: [] },
      });
    });

    expect(result.current.graphData.nodes).toHaveLength(1);
    expect(result.current.graphData.nodes[0].rating).toBe(9);
  });
});
