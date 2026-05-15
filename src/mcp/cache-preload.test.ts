/**
 * Tests for src/mcp/cache-preload.ts — smart cache preload for MCP session start.
 *
 * The module fetches graph, status, and cycles data from the daemon on port 5378,
 * caches it in memory, and provides invalidation / freshness checks.
 *
 * IMPORTANT: preloadForRepo uses Promise.all so all 3 requests fire concurrently.
 * The http.get mock uses a shared queue so each concurrent call gets its own
 * response, regardless of registration order.
 */

import * as http from 'http';

jest.mock('http');

const mockHttp = jest.mocked(http);

// Import after mocks
import { preloadForRepo, invalidatePreload, isPreloaded } from './cache-preload';

// ── Fixtures ─────────────────────────────────────────────────

const MOCK_GRAPH = {
  nodes: [{ id: '/repo/src/a.ts', label: 'a.ts', rating: 8 }],
  edges: [],
};

const MOCK_STATUS = { overallRating: 7.5, healthy: true };

const MOCK_CYCLES = [
  { nodes: ['/repo/src/x.ts', '/repo/src/y.ts'] },
];

// ── Queue-based http.get mock ────────────────────────────────
//
// Since preloadForRepo fires 3 requests concurrently via Promise.all, we need
// a single mockImplementation that pulls from a FIFO queue on each invocation.

interface QueueEntry {
  kind: 'data' | 'error' | 'timeout' | 'malformed';
  data?: unknown;
  errorMsg?: string;
}

let responseQueue: QueueEntry[] = [];

function pushResponse(data: unknown): void {
  responseQueue.push({ kind: 'data', data });
}

function pushError(msg: string): void {
  responseQueue.push({ kind: 'error', errorMsg: msg });
}

function pushTimeout(): void {
  responseQueue.push({ kind: 'timeout' });
}

function pushMalformed(): void {
  responseQueue.push({ kind: 'malformed' });
}

function installMockHttpGet(): void {
  (mockHttp.get as jest.Mock).mockImplementation((...args: unknown[]) => {
    const cb = typeof args[args.length - 1] === 'function'
      ? (args[args.length - 1] as (res: unknown) => void)
      : null;

    const entry = responseQueue.shift();

    const mockReq = {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (entry?.kind === 'error' && event === 'error') {
          process.nextTick(() => handler(new Error(entry.errorMsg)));
        }
        if (entry?.kind === 'timeout' && event === 'timeout') {
          process.nextTick(() => handler());
        }
        return mockReq;
      }),
      destroy: jest.fn(),
    };

    if (cb && entry) {
      if (entry.kind === 'data') {
        const dataStr = JSON.stringify(entry.data);
        let dataHandler: ((chunk: string) => void) | undefined;
        let endHandler: (() => void) | undefined;

        const res = {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') dataHandler = handler as (chunk: string) => void;
            if (event === 'end') endHandler = handler as () => void;
            return res;
          },
        };

        cb(res);

        process.nextTick(() => {
          if (dataHandler) dataHandler(dataStr);
          if (endHandler) endHandler();
        });
      } else if (entry.kind === 'malformed') {
        let dataHandler: ((chunk: string) => void) | undefined;
        let endHandler: (() => void) | undefined;

        const res = {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') dataHandler = handler as (chunk: string) => void;
            if (event === 'end') endHandler = handler as () => void;
            return res;
          },
        };

        cb(res);

        process.nextTick(() => {
          if (dataHandler) dataHandler('INVALID JSON{{{');
          if (endHandler) endHandler();
        });
      } else {
        cb({ on: () => undefined });
      }
    }

    return mockReq;
  });
}

// ── Cleanup ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  invalidatePreload();
  responseQueue = [];
  installMockHttpGet();
});

// ── preloadForRepo ───────────────────────────────────────────

describe('preloadForRepo', () => {
  it('fetches graph, status, and cycles from the daemon', async () => {
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);

    const result = await preloadForRepo('/repo');

    expect(result.graph).toEqual(MOCK_GRAPH);
    expect(result.status).toEqual(MOCK_STATUS);
    expect(result.cycles).toEqual(MOCK_CYCLES);
    expect(result.repo).toBe('/repo');
    expect(result.loadedAt).toBeGreaterThan(0);

    expect(mockHttp.get).toHaveBeenCalledTimes(3);

    const urls = mockHttp.get.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls[0]).toContain('/api/graph');
    expect(urls[1]).toContain('/api/status');
    expect(urls[2]).toContain('/api/cycles');
  });

  it('encodes the repo parameter in API URLs', async () => {
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);

    await preloadForRepo('/my repo/path');

    const urls = mockHttp.get.mock.calls.map((c: unknown[]) => String(c[0]));
    for (const url of urls) {
      expect(url).toContain(encodeURIComponent('/my repo/path'));
    }
  });

  it('returns cached data on second call without re-fetching', async () => {
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);
    await preloadForRepo('/repo');

    const result = await preloadForRepo('/repo');

    expect(result.graph).toEqual(MOCK_GRAPH);
    expect(result.status).toEqual(MOCK_STATUS);
    expect(result.cycles).toEqual(MOCK_CYCLES);
    expect(mockHttp.get).toHaveBeenCalledTimes(3);
  });

  it('re-fetches when repo changes (different repo key)', async () => {
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);
    await preloadForRepo('/repo-a');

    const graphB = { nodes: [], edges: [] };
    pushResponse(graphB);
    pushResponse({ overallRating: 5 });
    pushResponse([]);
    const resultB = await preloadForRepo('/repo-b');

    expect(resultB.repo).toBe('/repo-b');
    expect(mockHttp.get).toHaveBeenCalledTimes(6);
  });

  it('handles null graph response gracefully', async () => {
    pushResponse(null);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);

    const result = await preloadForRepo('/repo');

    expect(result.graph).toBeNull();
    expect(result.status).toEqual(MOCK_STATUS);
    expect(result.cycles).toEqual(MOCK_CYCLES);
  });

  it('handles null status response gracefully', async () => {
    pushResponse(MOCK_GRAPH);
    pushResponse(null);
    pushResponse(MOCK_CYCLES);

    const result = await preloadForRepo('/repo');

    expect(result.graph).toEqual(MOCK_GRAPH);
    expect(result.status).toBeNull();
    expect(result.cycles).toEqual(MOCK_CYCLES);
  });

  it('handles null cycles response gracefully', async () => {
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(null);

    const result = await preloadForRepo('/repo');

    expect(result.graph).toEqual(MOCK_GRAPH);
    expect(result.status).toEqual(MOCK_STATUS);
    expect(result.cycles).toBeNull();
  });

  it('handles all-null response gracefully', async () => {
    pushResponse(null);
    pushResponse(null);
    pushResponse(null);

    const result = await preloadForRepo('/repo');

    expect(result.graph).toBeNull();
    expect(result.status).toBeNull();
    expect(result.cycles).toBeNull();
  });
});

// ── Error handling ───────────────────────────────────────────

describe('preloadForRepo error handling', () => {
  it('handles http.get errors gracefully', async () => {
    pushError('ECONNREFUSED');
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);

    const result = await preloadForRepo('/repo');

    expect(result.graph).toBeNull();
    expect(result.status).toEqual(MOCK_STATUS);
    expect(result.cycles).toEqual(MOCK_CYCLES);
  });

  it('handles all http.get calls failing', async () => {
    pushError('ECONNREFUSED');
    pushError('ECONNREFUSED');
    pushError('ECONNREFUSED');

    const result = await preloadForRepo('/repo');

    expect(result.graph).toBeNull();
    expect(result.status).toBeNull();
    expect(result.cycles).toBeNull();
    expect(result.repo).toBe('/repo');
  });

  it('handles http.get timeout gracefully', async () => {
    pushTimeout();
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);

    const result = await preloadForRepo('/repo');

    expect(result.graph).toBeNull();
    expect(result.status).toEqual(MOCK_STATUS);
    expect(result.cycles).toEqual(MOCK_CYCLES);
  });

  it('handles malformed JSON response gracefully', async () => {
    pushMalformed();
    pushMalformed();
    pushMalformed();

    const result = await preloadForRepo('/repo');

    expect(result.graph).toBeNull();
    expect(result.status).toBeNull();
    expect(result.cycles).toBeNull();
  });
});

// ── invalidatePreload ────────────────────────────────────────

describe('invalidatePreload', () => {
  it('clears cached data so next call re-fetches', async () => {
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);
    await preloadForRepo('/repo');

    invalidatePreload();

    const freshGraph = { nodes: [], edges: [] };
    pushResponse(freshGraph);
    pushResponse({ overallRating: 0 });
    pushResponse([]);
    const result = await preloadForRepo('/repo');

    expect(result.graph).toEqual(freshGraph);
    expect(mockHttp.get).toHaveBeenCalledTimes(6);
  });

  it('is safe to call multiple times', () => {
    expect(() => {
      invalidatePreload();
      invalidatePreload();
      invalidatePreload();
    }).not.toThrow();
  });

  it('forces re-fetch even for same repo', async () => {
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);
    await preloadForRepo('/repo');

    invalidatePreload();

    const graphV2 = { nodes: [{ id: 'v2.ts', label: 'v2', rating: 9 }], edges: [] };
    pushResponse(graphV2);
    pushResponse({ overallRating: 9 });
    pushResponse([]);
    const result = await preloadForRepo('/repo');

    expect(result.graph).toEqual(graphV2);
  });
});

// ── isPreloaded ──────────────────────────────────────────────
//
// NOTE on timer handling: preloadForRepo uses process.nextTick (real async)
// so it needs real timers. After loading, we switch to fake timers with a
// known reference point for the freshness check.
//
// To avoid Date.now() drift between real and fake domains, we capture the
// loadedAt epoch from the PreloadedData and compute offsets from it.

describe('isPreloaded', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Preload with real timers and return the captured loadedAt. */
  async function preloadWithTimestamps(repo: string): Promise<number> {
    jest.useRealTimers();
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);
    const data = await preloadForRepo(repo);
    return data.loadedAt;
  }

  it('returns true when data is loaded and fresh (< 5 min)', async () => {
    const loadedAt = await preloadWithTimestamps('/repo');

    jest.useFakeTimers();
    jest.setSystemTime(loadedAt + 60 * 1000);

    expect(isPreloaded('/repo')).toBe(true);
  });

  it('returns false when data is stale (> 5 min)', async () => {
    const loadedAt = await preloadWithTimestamps('/repo');

    jest.useFakeTimers();
    jest.setSystemTime(loadedAt + 6 * 60 * 1000);

    expect(isPreloaded('/repo')).toBe(false);
  });

  it('returns false when no data has been loaded', () => {
    expect(isPreloaded('/repo')).toBe(false);
  });

  it('returns false when a different repo is loaded', async () => {
    jest.useRealTimers();
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);
    await preloadForRepo('/repo-a');

    expect(isPreloaded('/repo-b')).toBe(false);
  });

  it('returns false when cache is invalidated', async () => {
    jest.useRealTimers();
    pushResponse(MOCK_GRAPH);
    pushResponse(MOCK_STATUS);
    pushResponse(MOCK_CYCLES);
    await preloadForRepo('/repo');

    invalidatePreload();
    expect(isPreloaded('/repo')).toBe(false);
  });

  it('returns true exactly at the 5-minute boundary', async () => {
    const loadedAt = await preloadWithTimestamps('/repo');

    jest.useFakeTimers();
    jest.setSystemTime(loadedAt + 5 * 60 * 1000 - 1);

    expect(isPreloaded('/repo')).toBe(true);
  });

  it('returns false just past the 5-minute boundary', async () => {
    const loadedAt = await preloadWithTimestamps('/repo');

    jest.useFakeTimers();
    jest.setSystemTime(loadedAt + 5 * 60 * 1000 + 1);

    expect(isPreloaded('/repo')).toBe(false);
  });
});
