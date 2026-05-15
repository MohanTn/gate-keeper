/**
 * Tests for src/cli/query-repl.ts — interactive query REPL.
 *
 * Tests the exported QUERY_PATTERNS handlers (pure logic) and the
 * handleExplain / handlePath functions directly. The interactive
 * readline loop is tested through startRepl with a mocked interface.
 */

import * as http from 'http';
import * as readline from 'readline';
import * as cp from 'child_process';

jest.mock('http');
jest.mock('readline');
jest.mock('child_process');

const mockHttp = jest.mocked(http);
const mockReadline = jest.mocked(readline);
const mockCp = jest.mocked(cp);

// Import after mocks
import {
  startRepl,
  handleExplain,
  handlePath,
  QUERY_PATTERNS,
} from './query-repl';
import type { ReplGraph } from './repl-algorithms';

// ── Fixtures ─────────────────────────────────────────────────

const REPO = '/repo';

function makeNode(id: string, rating: number, violations: Array<{ type: string; severity: string }> = []) {
  return {
    id, label: id.split('/').pop()!,
    rating,
    metrics: { linesOfCode: 100, importCount: 3, cyclomaticComplexity: 5 },
    violations,
  };
}

const A = makeNode('/repo/src/auth/service.ts', 8);
const B = makeNode('/repo/src/db/pool.ts', 4, [{ type: 'issue', severity: 'error' }, { type: 'issue', severity: 'warning' }]);

const GRAPH: ReplGraph = {
  nodes: [A, B],
  edges: [
    { source: A.id, target: B.id, type: 'import', strength: 1 },
  ],
};

const EMPTY_GRAPH: ReplGraph = { nodes: [], edges: [] };

// ── Mock stdout / stderr ──────────────────────────────────────

let stdoutOutput: string[];
let stderrOutput: string[];

// Capture real write functions once so we can always restore to them,
// even when other test files in the same worker also spy on these.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const realStderrWrite = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  jest.clearAllMocks();
  stdoutOutput = [];
  stderrOutput = [];

  jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdoutOutput.push(String(chunk));
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderrOutput.push(String(chunk));
    return true;
  });
  // Prevent process.exit from killing the Jest worker
  jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  process.stdout.write = realStdoutWrite;
  process.stderr.write = realStderrWrite;
});

// ── QUERY_PATTERNS ────────────────────────────────────────────

describe('QUERY_PATTERNS', () => {
  it('has all expected pattern handlers', () => {
    const names = QUERY_PATTERNS.map(p => p.name);
    expect(names).toContain('god nodes');
    expect(names).toContain('surprising');
    expect(names).toContain('questions / suggestions');
    expect(names).toContain('health / quality');
  });

  describe('god nodes handler', () => {
    it('returns ranked list of most connected files', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'god nodes')!;
      const result = pattern.handler({} as RegExpExecArray, GRAPH, REPO);
      expect(result).toContain('connections');
      expect(result).toContain('service.ts');
    });

    it('returns empty message when graph has no nodes', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'god nodes')!;
      const result = pattern.handler({} as RegExpExecArray, EMPTY_GRAPH, REPO);
      expect(result).toBe('No files in graph.');
    });

    it('uses repo-relative paths', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'god nodes')!;
      const result = pattern.handler({} as RegExpExecArray, GRAPH, REPO);
      expect(result).toContain('src/auth/service.ts');
      expect(result).not.toContain('/repo/src/auth/service.ts');
    });
  });

  describe('surprising handler', () => {
    it('returns cross-module connections when they exist', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'surprising')!;
      const result = pattern.handler({} as RegExpExecArray, GRAPH, REPO);
      expect(result).toContain('→');
      expect(result).toContain('auth');
      expect(result).toContain('db');
    });

    it('returns empty message when no surprising connections', () => {
      const singleModule: ReplGraph = {
        nodes: [
          makeNode('/repo/src/auth/a.ts', 8),
          makeNode('/repo/src/auth/b.ts', 7),
        ],
        edges: [
          { source: '/repo/src/auth/a.ts', target: '/repo/src/auth/b.ts', type: 'import', strength: 1 },
        ],
      };
      const pattern = QUERY_PATTERNS.find(p => p.name === 'surprising')!;
      const result = pattern.handler({} as RegExpExecArray, singleModule, REPO);
      expect(result).toBe('No surprising cross-module connections found.');
    });
  });

  describe('questions handler', () => {
    it('returns auto-generated questions about the codebase', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'questions / suggestions')!;
      const result = pattern.handler({} as RegExpExecArray, GRAPH, REPO);
      expect(result).toContain('break');
      expect(result).toContain('service.ts');
    });

    it('mentions the worst-rated file when rating < 7', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'questions / suggestions')!;
      const result = pattern.handler({} as RegExpExecArray, GRAPH, REPO);
      // B has rating 4 < 7
      expect(result).toContain('pool.ts');
      expect(result).toContain('rating 4');
    });
  });

  describe('health handler', () => {
    it('reports file count and average rating', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'health / quality')!;
      const result = pattern.handler({} as RegExpExecArray, GRAPH, REPO);
      expect(result).toContain('2 files');
      expect(result).toContain('avg rating');
    });

    it('reports empty message when graph has no nodes', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'health / quality')!;
      const result = pattern.handler({} as RegExpExecArray, EMPTY_GRAPH, REPO);
      expect(result).toBe('No files in graph.');
    });

    it('lists worst files with error/warning counts', () => {
      const pattern = QUERY_PATTERNS.find(p => p.name === 'health / quality')!;
      const result = pattern.handler({} as RegExpExecArray, GRAPH, REPO);
      expect(result).toContain('4/10');
      expect(result).toContain('pool.ts');
      expect(result).toContain('1 errors');
      expect(result).toContain('1 warnings');
    });
  });
});

// ── handleExplain ─────────────────────────────────────────────

describe('handleExplain', () => {
  it('prints rating, LOC, complexity, imports, errors, warnings for found file', () => {
    handleExplain('service', GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('src/auth/service.ts');
    expect(output).toContain('Rating: 8');
    expect(output).toContain('LOC: 100');
    expect(output).toContain('Complexity: 5');
    expect(output).toContain('Imports: 3');
    expect(output).toContain('Errors: 0');
    expect(output).toContain('Warnings: 0');
  });

  it('prints file with error/warning counts', () => {
    handleExplain('pool', GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('Rating: 4');
    expect(output).toContain('Errors: 1');
    expect(output).toContain('Warnings: 1');
  });

  it('prints "not found" message when no match exists', () => {
    handleExplain('nonexistent', GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('No file matching');
    expect(output).toContain('nonexistent');
  });

  it('matches by partial file name (case insensitive)', () => {
    handleExplain('SERVICE', GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('service.ts');
  });

  it('matches by node id (full path) as fallback', () => {
    handleExplain('src/auth', GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('service.ts');
  });

  it('handles empty target string', () => {
    handleExplain('', GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('No file specified');
  });
});

// ── handlePath ────────────────────────────────────────────────

describe('handlePath', () => {
  it('prints short usage when not enough parts provided', () => {
    handlePath(['service'], GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('Usage: path');
  });

  it('prints empty parts message', () => {
    handlePath([], GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('Usage: path');
  });

  it('prints "could not find" when source file not in graph', () => {
    handlePath(['unknown.ts', 'service'], GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('Could not find matching files');
  });

  it('prints "could not find" when target file not in graph', () => {
    handlePath(['service', 'unknown.ts'], GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('Could not find matching files');
  });

  it('prints path when dependency chain exists', () => {
    handlePath(['service', 'pool'], GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('Path from');
    expect(output).toContain('auth/service.ts');
    expect(output).toContain('db/pool.ts');
  });

  it('prints no-path message when dependency chain does not exist', () => {
    // Reverse: pool does not depend on service
    handlePath(['pool', 'service'], GRAPH, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('No dependency path found');
  });

  it('resolves nodes by partial label match', () => {
    handlePath(['service', 'pool'], GRAPH, REPO);
    const output = stdoutOutput.join('');
    // Should find both nodes
    expect(output).not.toContain('Could not find');
    expect(output).toContain('auth/service.ts');
  });
});

// ── startRepl (mocked readline loop) ──────────────────────────

describe('startRepl', () => {
  let mockRl: {
    prompt: jest.Mock;
    close: jest.Mock;
    on: jest.Mock;
  };
  let lineHandler: ((line: string) => void | Promise<void>) | undefined;
  let closeHandler: (() => void) | undefined;

  beforeEach(() => {
    // Reset spies from the previous test without restoring (which can
    // interfere with other test files in the same worker).
    stdoutOutput = [];
    stderrOutput = [];

    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutOutput.push(String(chunk));
      return true;
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrOutput.push(String(chunk));
      return true;
    });

    // Setup readline mock
    lineHandler = undefined;
    closeHandler = undefined;

    mockRl = {
      prompt: jest.fn(),
      close: jest.fn(),
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'line') lineHandler = handler as (line: string) => void;
        if (event === 'close') closeHandler = handler as () => void;
        return mockRl;
      }),
    };

    (mockReadline.createInterface as jest.Mock).mockReturnValue(mockRl);

    // Mock child_process for findGitRoot
    (mockCp.spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: REPO,
      stderr: '',
      pid: 0,
      output: ['', REPO, ''],
      signal: null,
    } as unknown as cp.SpawnSyncReturns<Buffer>);

    // Mock http.get for graph loading
    const mockReq = {
      on: jest.fn(),
      destroy: jest.fn(),
    };

    const graphData = JSON.stringify(GRAPH);

    (mockHttp.get as jest.Mock).mockImplementation((...args: unknown[]) => {
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
          if (dataHandler) dataHandler(graphData);
          if (endHandler) endHandler();
        });
      }

      return mockReq;
    });
  });

  it('starts readline REPL with graph stats in header', async () => {
    await startRepl(REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('Gate Keeper Query REPL');
    expect(output).toContain('2 files');
    expect(output).toContain('1 edges');
  });

  it('responds to "help" command', async () => {
    await startRepl(REPO);
    // Simulate user typing "help"
    lineHandler!('help');
    const output = stdoutOutput.join('');
    expect(output).toContain('Natural language queries');
    expect(output).toContain('explain');
    expect(output).toContain('path');
    expect(output).toContain('quit');
  });

  it('responds to "god nodes" query', async () => {
    await startRepl(REPO);
    lineHandler!('god nodes');
    const output = stdoutOutput.join('');
    expect(output).toContain('connections');
  });

  it('responds to "surprising" query', async () => {
    await startRepl(REPO);
    lineHandler!('surprising connections');
    const output = stdoutOutput.join('');
    expect(output).toContain('→');
  });

  it('responds to "health" query', async () => {
    await startRepl(REPO);
    lineHandler!('health');
    const output = stdoutOutput.join('');
    expect(output).toContain('avg rating');
  });

  it('responds to "questions" query', async () => {
    await startRepl(REPO);
    lineHandler!('questions');
    const output = stdoutOutput.join('');
    expect(output).toContain('break');
  });

  it('responds to "explain" command', async () => {
    await startRepl(REPO);
    lineHandler!('explain service');
    const output = stdoutOutput.join('');
    expect(output).toContain('Rating: 8');
  });

  it('responds to "path" command', async () => {
    await startRepl(REPO);
    lineHandler!('path service pool');
    const output = stdoutOutput.join('');
    expect(output).toContain('Path from');
    expect(output).toContain('auth/service.ts');
  });

  it('responds to "quit" command by closing the interface', async () => {
    await startRepl(REPO);
    lineHandler!('quit');
    expect(mockRl.close).toHaveBeenCalled();
  });

  it('responds to "exit" command by closing the interface', async () => {
    await startRepl(REPO);
    lineHandler!('exit');
    expect(mockRl.close).toHaveBeenCalled();
  });

  it('ignores empty lines and just prompts again', async () => {
    await startRepl(REPO);
    const promptCountBefore = mockRl.prompt.mock.calls.length;
    lineHandler!('');
    // prompt should have been called again
    expect(mockRl.prompt.mock.calls.length).toBeGreaterThan(promptCountBefore);
  });

  it('shows "not recognised" message for unknown queries', async () => {
    await startRepl(REPO);
    lineHandler!('zzz unknown query zzz');
    const output = stdoutOutput.join('');
    expect(output).toContain('Query not recognised');
    expect(output).toContain('"god nodes"');
  });

  it('fires close handler gracefully', async () => {
    await startRepl(REPO);
    closeHandler!();
    const output = stdoutOutput.join('');
    expect(output).toContain('Goodbye');
  });

  it('handles "refresh" command when graph fetch succeeds', async () => {
    await startRepl(REPO);
    const p = lineHandler!('refresh');
    // The line handler is async — await its completion if it returns a promise
    if (p instanceof Promise) await p;
    const output = stdoutOutput.join('');
    expect(output).toContain('Refreshed');
    expect(output).toContain('2 files');
  });

  it('handles "refresh" command when graph fetch fails', async () => {
    // Track calls: first call (graph load) succeeds, second call (refresh) returns null
    let callCount = 0;
    const mockReq = { on: jest.fn(), destroy: jest.fn() };
    const mockReqGraph = JSON.stringify(GRAPH);
    (mockHttp.get as jest.Mock).mockImplementation((...args: unknown[]) => {
      callCount++;
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
          if (dataHandler) dataHandler(callCount === 1 ? mockReqGraph : 'null');
          if (endHandler) endHandler();
        });
      }
      return mockReq;
    });

    await startRepl(REPO);
    const p = lineHandler!('refresh');
    if (p instanceof Promise) await p;
    const output = stdoutOutput.join('');
    expect(output).toContain('Refresh failed');
  });

  it('prompts after each line is processed', async () => {
    await startRepl(REPO);
    lineHandler!('health');
    lineHandler!('god nodes');
    // prompt should be called multiple times (initial + each line processed)
    expect(mockRl.prompt.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('startRepl error handling', () => {
  it('handles empty graph gracefully via handleExplain and handlePath', () => {
    // Verify that REPL helpers don't crash on empty graphs
    handleExplain('anything', { nodes: [], edges: [] }, REPO);
    expect(stdoutOutput.join('')).toContain('No file matching');

    stdoutOutput.length = 0;
    handlePath(['source', 'dest'], { nodes: [], edges: [] }, REPO);
    const output = stdoutOutput.join('');
    expect(output).toContain('Could not find matching files');
  });

  it('query patterns return empty-graph messages', () => {
    const empty = { nodes: [], edges: [] };
    const godPattern = QUERY_PATTERNS.find(p => p.name === 'god nodes')!;
    expect(godPattern.handler({} as RegExpExecArray, empty, REPO)).toBe('No files in graph.');

    const healthPattern = QUERY_PATTERNS.find(p => p.name === 'health / quality')!;
    expect(healthPattern.handler({} as RegExpExecArray, empty, REPO)).toBe('No files in graph.');
  });
});
