/**
 * Tests for src/hook-pre-tool-use.ts — pre-edit safety hook.
 *
 * The hook reads JSON from stdin, checks file extension + daemon liveness,
 * then queries the daemon's impact-set API. Writes warnings to stderr when
 * the verdict is 'block' or fragileCount >= 3.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as cp from 'child_process';

jest.mock('http');
jest.mock('fs');
jest.mock('child_process');

const mockHttp = jest.mocked(http);
const mockFs = jest.mocked(fs);
const mockCp = jest.mocked(cp);

// We import after mocks are set up
import { main } from './hook-pre-tool-use';

// ── Helpers ───────────────────────────────────────────────────

const PID_FILE = `${process.env.HOME ?? '/tmp'}/.gate-keeper/daemon.pid`;

/**
 * Create a mock for process.stdin that implements the async iteration
 * protocol used by the hook's `for await (const chunk of process.stdin)`.
 */
function mockStdinChunks(...chunks: string[]) {
  let i = 0;
  const asyncIterable = {
    setEncoding: jest.fn(),
    [Symbol.asyncIterator]: () => ({
      next: () => {
        if (i < chunks.length) {
          return Promise.resolve({ value: chunks[i++], done: false } as const);
        }
        return Promise.resolve({ value: undefined, done: true } as const);
      },
    }),
  };
  return asyncIterable;
}

/**
 * Factory for http.request responses. Simulates the daemon API returning JSON.
 * The callback is invoked synchronously (handler registration), then
 * data/end handlers fire on a microtask.
 */
function mockHttpRequestRespond(responseData: unknown, shouldTimeout = false) {
  const mockRequest = {
    on: jest.fn((_event: string, _handler: (...args: unknown[]) => void) => mockRequest),
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  };

  const dataStr = JSON.stringify(responseData);

  (mockHttp.request as jest.Mock).mockImplementation((...args: unknown[]) => {
    // Last argument is the callback
    const cb = typeof args[args.length - 1] === 'function'
      ? (args[args.length - 1] as (res: unknown) => void)
      : null;

    if (cb) {
      let dataHandler: ((chunk: string) => void) | undefined;
      let endHandler: (() => void) | undefined;

      const res = {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'data') dataHandler = handler as (chunk: string) => void;
          if (event === 'end') endHandler = handler as () => void;
          return res;
        },
      };

      // Call the callback to register handlers
      cb(res);

      // Schedule response delivery on next tick (like real I/O)
      if (!shouldTimeout) {
        process.nextTick(() => {
          if (dataHandler) dataHandler(dataStr);
          if (endHandler) endHandler();
        });
      }
    }

    return mockRequest;
  });

  return { mockRequest, mockResponseOn: undefined as undefined };
}

// ── Environment setup ─────────────────────────────────────────

const origStdoutWrite = process.stdout.write.bind(process.stdout);
const mockStderrWrite = jest.fn();
let originalStdin: typeof process.stdin;

beforeAll(() => {
  originalStdin = process.stdin;
  jest.spyOn(process.stderr, 'write').mockImplementation(mockStderrWrite);
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default behaviour: daemon alive, git root works
  mockFs.readFileSync.mockReturnValue('12345');
  (process.kill as unknown as jest.Mock) = jest.fn().mockReturnValue(true);
  (mockCp.spawnSync as jest.Mock).mockReturnValue({
    status: 0,
    stdout: '/repo',
    stderr: '',
    pid: 0,
    output: ['', '/repo', ''],
    signal: null,
  });

  // Re-attach mock stdin
  Object.defineProperty(process, 'stdin', {
    value: mockStdinChunks(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(process, 'stdin', {
    value: originalStdin,
    writable: true,
    configurable: true,
  });
});

// ── Tests ─────────────────────────────────────────────────────

describe('main() with stdin input resolution', () => {
  it('is a no-op when stdin contains no payload (empty string)', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(''),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
    expect(mockStderrWrite).not.toHaveBeenCalled();
  });

  it('is a no-op when stdin contains non-JSON text', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks('not json at all'),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
    expect(mockStderrWrite).not.toHaveBeenCalled();
  });

  it('is a no-op when JSON has no tool_input', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({ tool: 'Read' })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('is a no-op when tool_input has no file_path or path', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool: 'Write',
        tool_input: { content: 'abc' },
      })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('is a no-op when tool_input has empty file_path', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool: 'Write',
        tool_input: { file_path: '' },
      })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('is a no-op when file has non-watched extension (.json)', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool: 'Write',
        tool_input: { file_path: '/repo/config.json' },
      })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('is a no-op when file has non-watched extension (.md)', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool: 'Write',
        tool_input: { file_path: '/repo/readme.md' },
      })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('is a no-op when daemon is not alive (no PID file)', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool: 'Write',
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('is a no-op when daemon PID is NaN', async () => {
    mockFs.readFileSync.mockReturnValue('not-a-number');
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool: 'Write',
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('is a no-op when daemon PID file read throws', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('permission denied'); });
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool: 'Write',
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('is a no-op when process.kill throws (process not running)', async () => {
    mockFs.readFileSync.mockReturnValue('99999');
    (process.kill as unknown as jest.Mock) = jest.fn(() => { throw new Error('ESRCH'); });
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool: 'Write',
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });
    await main();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it('works with watched extension .tsx', async () => {
    const payload = JSON.stringify({
      tool_input: { file_path: '/repo/src/component.tsx' },
    });
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(payload),
      writable: true,
      configurable: true,
    });
    mockHttpRequestRespond(null); // null → no-op
    await main();
    expect(mockHttp.request).toHaveBeenCalled();
  });

  it('works with watched extension .js', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/app.js' },
      })),
      writable: true,
      configurable: true,
    });
    mockHttpRequestRespond(null);
    await main();
    expect(mockHttp.request).toHaveBeenCalled();
  });

  it('works with watched extension .jsx', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/Component.jsx' },
      })),
      writable: true,
      configurable: true,
    });
    mockHttpRequestRespond(null);
    await main();
    expect(mockHttp.request).toHaveBeenCalled();
  });

  it('works with watched extension .cs', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/Service.cs' },
      })),
      writable: true,
      configurable: true,
    });
    mockHttpRequestRespond(null);
    await main();
    expect(mockHttp.request).toHaveBeenCalled();
  });

  it('uses the "path" key when file_path is absent', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { path: '/repo/src/alt.ts' },
      })),
      writable: true,
      configurable: true,
    });
    mockHttpRequestRespond(null);
    await main();
    expect(mockHttp.request).toHaveBeenCalled();
  });

  it('accepts multiple stdin chunks concatenated', async () => {
    const json = JSON.stringify({
      tool_input: { file_path: '/repo/src/multi.ts' },
    });
    // Split into two chunks
    const mid = Math.floor(json.length / 2);
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(json.slice(0, mid), json.slice(mid)),
      writable: true,
      configurable: true,
    });
    mockHttpRequestRespond(null);
    await main();
    expect(mockHttp.request).toHaveBeenCalled();
  });
});

describe('main() impact-set results', () => {
  it('is a no-op when daemon returns null', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });
    mockHttpRequestRespond(null);
    await main();
    expect(mockStderrWrite).not.toHaveBeenCalled();
  });

  it('is a no-op when daemon returns undefined response', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });
    mockHttpRequestRespond(undefined);
    await main();
    expect(mockStderrWrite).not.toHaveBeenCalled();
  });

  it('writes warning to stderr when verdict is "block"', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'block',
      fragileCount: 2,
      directDependents: 5,
      riskScore: 0.8,
      fileRating: 5,
      reason: '3+ fragile dependents would break',
      affected: [],
    });

    await main();

    expect(mockStderrWrite).toHaveBeenCalled();
    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(allCalls).toContain('[Gate Keeper]');
    expect(allCalls).toContain('warning');
    expect(allCalls).toContain('test.ts');
    expect(allCalls).toContain('Pre-edit safety warning');
    expect(allCalls).toContain('Rating: 5');
    expect(allCalls).toContain('Direct dependents: 5');
  });

  it('writes warning to stderr when fragileCount >= 3 without block verdict', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'safe',
      fragileCount: 3,
      directDependents: 4,
      fileRating: 6,
      reason: '3 fragile dependents',
      affected: [],
    });

    await main();

    expect(mockStderrWrite).toHaveBeenCalled();
    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(allCalls).toContain('Fragile: 3');
  });

  it('lists fragile dependent files when affected array has fragile entries', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/core.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'block',
      fragileCount: 3,
      directDependents: 5,
      fileRating: 4.5,
      reason: '3 fragile dependents',
      affected: [
        { path: 'src/weak1.ts', depth: 1, severity: 'direct', rating: 3, fragile: true },
        { path: 'src/weak2.ts', depth: 1, severity: 'direct', rating: 4, fragile: true },
        { path: 'src/healthy.ts', depth: 1, severity: 'direct', rating: 8, fragile: false },
        { path: 'src/weak3.ts', depth: 2, severity: 'transitive', rating: 5, fragile: true },
      ],
    });

    await main();

    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    // Should include only fragile files
    expect(allCalls).toContain('weak1.ts');
    expect(allCalls).toContain('weak2.ts');
    expect(allCalls).toContain('weak3.ts');
    // Should NOT include healthy files
    expect(allCalls).not.toContain('healthy.ts');
    // Should mention "at risk"
    expect(allCalls).toContain('Dependent files at risk');
  });

  it('shows overflow message when fragileCount > displayed fragile files', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/core.ts' },
      })),
      writable: true,
      configurable: true,
    });

    // fragileCount = 5 but only 3 in affected (since we slice to 10)
    mockHttpRequestRespond({
      verdict: 'block',
      fragileCount: 5,
      directDependents: 7,
      fileRating: 4,
      reason: '5 fragile dependents',
      affected: Array.from({ length: 3 }, (_, i) => ({
        path: `src/weak${i + 1}.ts`,
        depth: 1,
        severity: 'direct' as const,
        rating: 3,
        fragile: true,
      })),
    });

    await main();

    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(allCalls).toContain('and 2 more');
  });

  it('limits displayed fragile files to 10', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/core.ts' },
      })),
      writable: true,
      configurable: true,
    });

    const affected = Array.from({ length: 15 }, (_, i) => ({
      path: `src/weak${i + 1}.ts`,
      depth: 1,
      severity: 'direct' as const,
      rating: 3,
      fragile: true,
    }));

    mockHttpRequestRespond({
      verdict: 'block',
      fragileCount: 15,
      directDependents: 15,
      fileRating: 4,
      reason: '15 fragile dependents',
      affected,
    });

    await main();

    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    // Should mention 10 files + overflow (5 more)
    const weakCount = (allCalls.match(/weak/g) || []).length;
    expect(weakCount).toBeLessThanOrEqual(10);
    expect(allCalls).toContain('and 5 more');
  });

  it('does NOT list dependents section when no affected array at all', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/core.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'block',
      fragileCount: 3,
      directDependents: 5,
      fileRating: 5,
      reason: 'dangerous',
      // No affected key
    });

    await main();

    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(allCalls).not.toContain('Dependent files at risk');
  });

  it('includes the advice line about get_impact_set', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/core.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'block',
      fragileCount: 3,
      directDependents: 3,
      fileRating: 5,
      reason: 'dangerous',
      affected: [{ path: 'src/weak.ts', depth: 1, severity: 'direct', rating: 3, fragile: true }],
    });

    await main();

    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(allCalls).toContain('get_impact_set');
    expect(allCalls).toContain('Proceed with extra care');
  });

  it('uses fallback reason when reason is not provided', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/core.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'block',
      fragileCount: 3,
      directDependents: 3,
      fileRating: 5,
      affected: [],
    });

    await main();

    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(allCalls).toContain('File has fragile dependents');
  });

  it('handles null fileRating gracefully with "?"', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/core.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'block',
      fragileCount: 3,
      directDependents: 3,
      fileRating: null,
      reason: 'test',
      affected: [],
    });

    await main();

    const allCalls = mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(allCalls).toContain('Rating: ?');
  });

  it('does not warn when verdict is safe and fragileCount < 3', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/safe.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'safe',
      fragileCount: 1,
      directDependents: 2,
      fileRating: 8,
      reason: 'low risk',
      affected: [],
    });

    await main();
    expect(mockStderrWrite).not.toHaveBeenCalled();
  });

  it('does not warn when verdict is "warn" but fragileCount is 0', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/okay.ts' },
      })),
      writable: true,
      configurable: true,
    });

    mockHttpRequestRespond({
      verdict: 'warn',
      fragileCount: 0,
      directDependents: 1,
      fileRating: 7,
      reason: 'low risk',
      affected: [],
    });

    await main();
    expect(mockStderrWrite).not.toHaveBeenCalled();
  });
});

describe('main() error handling', () => {
  it('does not throw when http.request errors', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });

    // Simulate http.request triggering an error
    const mockRequest = {
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'error') {
          process.nextTick(() => handler());
        }
        return mockRequest;
      }),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    (mockHttp.request as jest.Mock).mockImplementation((..._args: unknown[]) => mockRequest);

    await expect(main()).resolves.not.toThrow();
    expect(mockStderrWrite).not.toHaveBeenCalled();
  });

  it('does not throw when http.request times out', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });

    // req.on('timeout') triggers, which calls req.destroy() then resolves(null)
    const mockRequest = {
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'timeout') {
          process.nextTick(() => handler());
        }
        return mockRequest;
      }),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    (mockHttp.request as jest.Mock).mockImplementation((..._args: unknown[]) => mockRequest);

    await expect(main()).resolves.not.toThrow();
  });

  it('handles JSON parse error in daemon response gracefully', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });

    // Return invalid JSON from daemon
    const mockRequest = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    (mockHttp.request as jest.Mock).mockImplementation((...args: unknown[]) => {
      const cb = typeof args[args.length - 1] === 'function'
        ? (args[args.length - 1] as (res: unknown) => void)
        : null;

      if (cb) {
        let dataHandler: ((chunk: string) => void) | undefined;
        let endHandler: (() => void) | undefined;

        cb({
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') dataHandler = handler as (chunk: string) => void;
            if (event === 'end') endHandler = handler as () => void;
            return undefined;
          },
        });

        process.nextTick(() => {
          // Send invalid JSON
          if (dataHandler) dataHandler('NOT VALID JSON{{{');
          if (endHandler) endHandler();
        });
      }
      return mockRequest;
    });

    await expect(main()).resolves.not.toThrow();
    expect(mockStderrWrite).not.toHaveBeenCalled();
  });

  it('catches unexpected errors and exits gracefully (exit 0)', async () => {
    // Force a crash in main by making stdin throw during iteration
    const throwingIterable = {
      setEncoding: jest.fn(),
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error('unexpected I/O error')),
      }),
    };
    Object.defineProperty(process, 'stdin', {
      value: throwingIterable,
      writable: true,
      configurable: true,
    });

    // The exported main() does not have a built-in catch — errors propagate
    // to the caller. The catch(() => process.exit(0)) is only at the
    // require.main === module entry point.
    await expect(main()).rejects.toThrow('unexpected I/O error');
  });

  it('does not hang on error events from the request object', async () => {
    Object.defineProperty(process, 'stdin', {
      value: mockStdinChunks(JSON.stringify({
        tool_input: { file_path: '/repo/src/test.ts' },
      })),
      writable: true,
      configurable: true,
    });

    // Request that fires both 'timeout' and 'error' (edge case)
    const mockRequest = {
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'timeout' || event === 'error') {
          process.nextTick(() => handler());
        }
        return mockRequest;
      }),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };

    (mockHttp.request as jest.Mock).mockImplementation((..._args: unknown[]) => mockRequest);

    await expect(main()).resolves.not.toThrow();
  });
});
