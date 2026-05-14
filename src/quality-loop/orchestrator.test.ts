import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteCache } from '../cache/sqlite-cache';
import { QualityOrchestrator, loadQualityConfig, saveQualityConfig } from './orchestrator';
import { FixWorker } from './fix-worker';
import * as cp from 'child_process';
import { QueueManager } from './queue-manager';
import { FileAnalysis, QualityLoopConfig, WorkerResult, WSMessage } from '../types';

// Neutralize FixWorker — every `new FixWorker(...)` in run()/runWorker() gets a stub
// whose .fix() resolves to a controllable result. Individual tests override the impl.
jest.mock('./fix-worker', () => ({
  FixWorker: jest.fn().mockImplementation(() => ({
    fix: jest.fn().mockResolvedValue({
      success: true,
      newRating: 8,
      ratingBefore: 4,
      violationsRemaining: 0,
      violationsFixed: 2,
      durationMs: 5,
      attemptNumber: 1,
      fixSummary: 'mock fix',
      shouldRetry: false,
    } satisfies WorkerResult),
  })),
}));

// Wrap fs.existsSync and child_process.execSync in jest.fn() so resolveClaudePath tests
// can control which paths "exist" and whether `which claude` fails.
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: jest.fn().mockImplementation(actual.existsSync) };
});
jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  return { ...actual, execSync: jest.fn().mockImplementation(actual.execSync) };
});

const FixWorkerMock = FixWorker as unknown as jest.Mock;

function makeConfig(overrides: Partial<QualityLoopConfig> = {}): QualityLoopConfig {
  return {
    threshold: 7,
    maxWorkers: 2,
    maxAttemptsPerFile: 3,
    workerMode: 'auto',
    repos: [],
    excludePatterns: [],
    checkpointIntervalSec: 30,
    heartbeatIntervalSec: 10,
    ...overrides,
  };
}

function makeOrchestrator(
  cfg?: Partial<QualityLoopConfig>,
  analyses: Array<{ path: string; rating: number; repoRoot: string }> = [],
) {
  const cache = new SqliteCache(':memory:');
  const broadcasts: WSMessage[] = [];
  const callbacks = {
    broadcast: (msg: WSMessage) => { broadcasts.push(msg); },
    getAnalyzedFiles: () => analyses,
  };
  const orch = new QualityOrchestrator(makeConfig(cfg), cache, callbacks);
  return { orch, cache, broadcasts };
}

describe('QualityOrchestrator', () => {
  describe('lifecycle flags', () => {
    it('is not running before start', () => {
      const { orch } = makeOrchestrator();
      expect(orch.isRunning).toBe(false);
      expect(orch.isPaused).toBe(false);
    });

    it('toggles paused state via pause/resume', () => {
      const { orch } = makeOrchestrator();
      orch.pause();
      expect(orch.isPaused).toBe(true);
      orch.resume();
      expect(orch.isPaused).toBe(false);
    });

    it('stop sets stopped flag', () => {
      const { orch } = makeOrchestrator();
      orch.stop();
      expect(orch.isRunning).toBe(false);
    });
  });

  describe('config management', () => {
    let tmpHome: string;
    let originalHome: string | undefined;

    beforeEach(() => {
      tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-orch-'));
      originalHome = process.env.HOME;
      process.env.HOME = tmpHome;
      fs.mkdirSync(path.join(tmpHome, '.gate-keeper'), { recursive: true });
    });

    afterEach(() => {
      process.env.HOME = originalHome;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('getConfig returns a shallow clone', () => {
      const { orch } = makeOrchestrator({ threshold: 6 });
      const cfg = orch.getConfig();
      expect(cfg.threshold).toBe(6);
      cfg.threshold = 1;
      expect(orch.getConfig().threshold).toBe(6);
    });

    it('updateConfig applies partial fields', () => {
      const { orch } = makeOrchestrator();
      orch.updateConfig({ threshold: 8.5, maxWorkers: 4 });
      const cfg = orch.getConfig();
      expect(cfg.threshold).toBe(8.5);
      expect(cfg.maxWorkers).toBe(4);
      expect(cfg.maxAttemptsPerFile).toBe(3);
    });

    it('updateConfig ignores undefined fields', () => {
      const { orch } = makeOrchestrator({ threshold: 5 });
      orch.updateConfig({});
      expect(orch.getConfig().threshold).toBe(5);
    });
  });

  describe('queue helpers', () => {
    it('enqueueRepos with no repos returns 0', async () => {
      const { orch } = makeOrchestrator();
      await expect(orch.enqueueRepos()).resolves.toBe(0);
    });

    it('getQueueItems returns an empty array initially', () => {
      const { orch } = makeOrchestrator();
      expect(orch.getQueueItems()).toEqual([]);
    });

    it('resetFailed returns a number', () => {
      const { orch } = makeOrchestrator();
      expect(typeof orch.resetFailed()).toBe('number');
    });

    it('enqueueRepos enqueues files below threshold via buildQueue', async () => {
      const analyses = [
        { path: '/repo/a.ts', rating: 4, repoRoot: '/repo' },
        { path: '/repo/b.ts', rating: 8, repoRoot: '/repo' },
        { path: '/repo/c.ts', rating: 3, repoRoot: '/repo' },
      ];
      const { orch } = makeOrchestrator({ repos: ['/repo'], threshold: 7 }, analyses);
      const enqueued = await orch.enqueueRepos();
      expect(enqueued).toBe(2);
      expect(orch.getQueueItems().map(i => i.filePath).sort())
        .toEqual(['/repo/a.ts', '/repo/c.ts']);
    });

    it('getTrends returns an array', () => {
      const { orch } = makeOrchestrator();
      expect(Array.isArray(orch.getTrends())).toBe(true);
    });

    it('getAttempts returns an array for an unknown queue id', () => {
      const { orch } = makeOrchestrator();
      expect(orch.getAttempts(999)).toEqual([]);
    });

    it('stats returns queue stats shape', () => {
      const { orch } = makeOrchestrator();
      const stats = orch.stats;
      expect(stats).toEqual(expect.objectContaining({
        total: expect.any(Number),
        pending: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
      }));
    });
  });
});

describe('loadQualityConfig', () => {
  it('returns a fully-populated QualityLoopConfig', () => {
    const cfg = loadQualityConfig();
    expect(typeof cfg.threshold).toBe('number');
    expect(typeof cfg.maxWorkers).toBe('number');
    expect(Array.isArray(cfg.repos)).toBe(true);
    expect(['cli', 'api', 'auto']).toContain(cfg.workerMode);
  });
});

describe('loadQualityConfig error handling', () => {
  // QUALITY_CONFIG_PATH is a module-level constant derived from HOME at import time.
  // We must work with the real path directly.

  it('returns defaults on corrupt config file', () => {
    const actualHome = process.env.HOME ?? '/tmp';
    const configPath = path.join(actualHome, '.gate-keeper', 'quality-config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Backup any existing config so we can restore it
    let backup: string | null = null;
    if (fs.existsSync(configPath)) {
      backup = fs.readFileSync(configPath, 'utf8');
    }

    try {
      fs.writeFileSync(configPath, 'not valid json{', 'utf8');
      const cfg = loadQualityConfig();
      expect(cfg.threshold).toBe(7.0);
      expect(cfg.workerMode).toBe('auto');
    } finally {
      if (backup !== null) {
        fs.writeFileSync(configPath, backup, 'utf8');
      } else {
        try { fs.unlinkSync(configPath); } catch { /* file may not exist */ }
      }
    }
  });
});

describe('saveQualityConfig', () => {
  it('writes JSON to disk that loadQualityConfig can read back', () => {
    const cfg: QualityLoopConfig = {
      threshold: 8.2,
      maxWorkers: 5,
      maxAttemptsPerFile: 2,
      workerMode: 'cli',
      repos: ['/tmp/r'],
      excludePatterns: [],
      checkpointIntervalSec: 60,
      heartbeatIntervalSec: 5,
    };
    saveQualityConfig(cfg);
    const loaded = loadQualityConfig();
    expect(loaded.threshold).toBe(cfg.threshold);
    expect(loaded.repos).toEqual(cfg.repos);
  });
});

// ── Additional coverage for run loop, runWorker, and private helpers ──

type OrchestratorInternals = {
  resolveRepo: (filePath: string) => string;
  handleWorkerTimeout: (workerId: string) => void;
  getOverallRating: () => number;
  getTotalFiles: () => number;
  broadcastProgress: (stats: unknown) => void;
  broadcastItem: (id: number) => void;
  broadcast: (msg: WSMessage) => void;
  saveFinalCheckpoint: (reason: string) => Promise<void>;
  buildQueue: () => Promise<number>;
  cleanup: () => void;
  log: (msg: string) => void;
  activeWorkers: Map<string, { queueId: number; filePath: string; promise: Promise<void>; startTime: number; timeout: NodeJS.Timeout }>;
  runWorker: (queueId: number, filePath: string, workerId: string, startTime: number) => Promise<void>;
  resolveClaudePath: () => string;
  queue: QueueManager;
  loopPromise: Promise<void> | null;
  config: QualityLoopConfig;
};

function asInternals(orch: QualityOrchestrator): OrchestratorInternals {
  return orch as unknown as OrchestratorInternals;
}

function makeAnalysis(p: string, rating: number, repo = '/repo'): FileAnalysis {
  return {
    path: p,
    language: 'typescript',
    dependencies: [],
    metrics: { loc: 10, complexity: 1, importCount: 0 } as never,
    violations: [],
    rating,
    analyzedAt: Date.now(),
    repoRoot: repo,
  } as FileAnalysis;
}

describe('QualityOrchestrator.run() — empty queue path', () => {
  beforeEach(() => { FixWorkerMock.mockClear(); });

  it('start() guards against double-start', async () => {
    const { orch } = makeOrchestrator();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    orch.start();
    orch.start();
    orch.stop();
    await new Promise(r => setTimeout(r, 50));
    expect(errSpy.mock.calls.some(c => String(c[0]).includes('Already running'))).toBe(true);
    errSpy.mockRestore();
  });

  it('drives the run() loop end-to-end with one queued file (spawns mocked worker)', async () => {
    const analyses = [{ path: '/repo/integ.ts', rating: 4, repoRoot: '/repo' }];
    const { orch, broadcasts } = makeOrchestrator(
      { repos: ['/repo'], maxWorkers: 1, heartbeatIntervalSec: 60, checkpointIntervalSec: 60 },
      analyses,
    );
    jest.spyOn(console, 'error').mockImplementation(() => {});

    orch.start();
    // Give the loop time to: enqueue → pick → spawn worker → resolve → broadcast → break
    await new Promise(r => setTimeout(r, 300));
    orch.stop();
    const internals = asInternals(orch);
    if (internals.loopPromise) await internals.loopPromise.catch(() => {});

    expect(FixWorkerMock).toHaveBeenCalled();
    expect(broadcasts.some(b => b.type === 'worker_activity' && b.workerAction === 'start')).toBe(true);
    expect(broadcasts.some(b => b.type === 'worker_activity' && b.workerAction === 'complete')).toBe(true);
  });

  it('runs to completion when queue is empty and broadcasts a done message', async () => {
    const { orch, broadcasts } = makeOrchestrator();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    orch.start();
    // Loop should fast-finish: empty queue → completion branch → break
    await new Promise(r => setTimeout(r, 100));
    orch.stop();
    // Drain any pending iteration
    const internals = asInternals(orch);
    if (internals.loopPromise) await internals.loopPromise.catch(() => {});
    expect(broadcasts.some(b => b.type === 'queue_progress' && b.queueDone === true)).toBe(true);
    expect(orch.isRunning).toBe(false);
  });

  it('catches loop rejection and calls stop()', async () => {
    const cache = new SqliteCache(':memory:');
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Make buildQueue throw so the loop promise rejects
    const callbacks = {
      broadcast: () => {},
      getAnalyzedFiles: () => { throw new Error('simulated failure'); },
    };
    const orch = new QualityOrchestrator(makeConfig({ repos: ['/repo'] }), cache, callbacks);

    orch.start();
    const internals = asInternals(orch);
    if (internals.loopPromise) await internals.loopPromise.catch(() => {});

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Fatal loop error'),
      expect.any(Error),
    );
    expect(orch.isRunning).toBe(false);
    errSpy.mockRestore();
  });
});

describe('QualityOrchestrator.runWorker()', () => {
  beforeEach(() => { FixWorkerMock.mockClear(); });

  it('marks the queue item completed and broadcasts on success', async () => {
    const analyses = [{ path: '/repo/a.ts', rating: 4, repoRoot: '/repo' }];
    const { orch, broadcasts } = makeOrchestrator({ repos: ['/repo'] }, analyses);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await orch.enqueueRepos();
    const item = orch.getQueueItems()[0];

    await asInternals(orch).runWorker(item.id, item.filePath, 'w1', Date.now());

    const after = orch.getQueueItems().find(i => i.id === item.id);
    expect(after?.status).toBe('completed');
    expect(broadcasts.some(b => b.type === 'worker_activity' && b.workerSuccess === true)).toBe(true);
  });

  it('marks the queue item failed and broadcasts an error when fix() rejects', async () => {
    FixWorkerMock.mockImplementationOnce(() => ({
      fix: jest.fn().mockRejectedValue(new Error('boom')),
    }));
    const analyses = [{ path: '/repo/b.ts', rating: 4, repoRoot: '/repo' }];
    const { orch, broadcasts } = makeOrchestrator({ repos: ['/repo'], maxAttemptsPerFile: 1 }, analyses);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await orch.enqueueRepos();
    const item = orch.getQueueItems()[0];

    await asInternals(orch).runWorker(item.id, item.filePath, 'w2', Date.now());

    const after = orch.getQueueItems().find(i => i.id === item.id);
    // markFailed sets status to 'pending' or 'skipped' depending on attempts vs maxAttempts.
    // Either way, it must NOT be 'completed' and an error broadcast must exist.
    expect(after?.status).not.toBe('completed');
    expect(broadcasts.some(b => b.type === 'worker_activity' && b.workerAction === 'error')).toBe(true);
  });

  it('records an attempt log entry', async () => {
    const analyses = [{ path: '/repo/c.ts', rating: 4, repoRoot: '/repo' }];
    const { orch } = makeOrchestrator({ repos: ['/repo'] }, analyses);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await orch.enqueueRepos();
    const item = orch.getQueueItems()[0];

    await asInternals(orch).runWorker(item.id, item.filePath, 'w3', Date.now());

    expect(orch.getAttempts(item.id).length).toBeGreaterThan(0);
  });
});

describe('QualityOrchestrator private helpers', () => {
  it('resolveRepo picks the matching repo prefix', () => {
    const { orch } = makeOrchestrator({ repos: ['/r1', '/r2'] });
    expect(asInternals(orch).resolveRepo('/r2/src/x.ts')).toBe('/r2');
  });

  it('resolveRepo falls back to the first repo when no prefix matches', () => {
    const { orch } = makeOrchestrator({ repos: ['/r1'] });
    expect(asInternals(orch).resolveRepo('/elsewhere/x.ts')).toBe('/r1');
  });

  it('resolveRepo falls back to dirname when repos is empty', () => {
    const { orch } = makeOrchestrator({ repos: [] });
    expect(asInternals(orch).resolveRepo('/no/repo/x.ts')).toBe('/no/repo');
  });

  it('handleWorkerTimeout removes the worker and releases its lock', () => {
    const { orch } = makeOrchestrator();
    const internals = asInternals(orch);
    const fakeTimeout = setTimeout(() => {}, 1_000_000);
    internals.activeWorkers.set('wT', {
      queueId: 1,
      filePath: '/repo/x.ts',
      promise: Promise.resolve(),
      startTime: Date.now(),
      timeout: fakeTimeout,
    });
    internals.handleWorkerTimeout('wT');
    expect(internals.activeWorkers.has('wT')).toBe(false);
    clearTimeout(fakeTimeout);
  });

  it('handleWorkerTimeout is a no-op for unknown workers', () => {
    const { orch } = makeOrchestrator();
    expect(() => asInternals(orch).handleWorkerTimeout('nope')).not.toThrow();
  });

  it('getOverallRating averages cached file ratings', () => {
    const { orch, cache } = makeOrchestrator();
    cache.save(makeAnalysis('/repo/a.ts', 6));
    cache.save(makeAnalysis('/repo/b.ts', 8));
    expect(asInternals(orch).getOverallRating()).toBe(7);
  });

  it('getOverallRating returns 10 for an empty cache', () => {
    const { orch } = makeOrchestrator();
    expect(asInternals(orch).getOverallRating()).toBe(10);
  });

  it('getTotalFiles returns the number of cached analyses', () => {
    const { orch, cache } = makeOrchestrator();
    cache.save(makeAnalysis('/repo/a.ts', 6));
    expect(asInternals(orch).getTotalFiles()).toBe(1);
  });

  it('broadcast() swallows callback errors', () => {
    const cache = new SqliteCache(':memory:');
    const callbacks = {
      broadcast: () => { throw new Error('downstream blew up'); },
      getAnalyzedFiles: () => [],
    };
    const orch = new QualityOrchestrator(makeConfig(), cache, callbacks);
    expect(() => asInternals(orch).broadcast({ type: 'queue_progress' } as WSMessage)).not.toThrow();
  });

  it('broadcastItem skips when the item is missing', () => {
    const { orch, broadcasts } = makeOrchestrator();
    asInternals(orch).broadcastItem(99999);
    expect(broadcasts.filter(b => b.type === 'queue_update')).toEqual([]);
  });

  it('saveFinalCheckpoint emits a queue_progress message with queueDone=true', async () => {
    const { orch, broadcasts } = makeOrchestrator();
    await asInternals(orch).saveFinalCheckpoint('test');
    expect(broadcasts.some(b => b.type === 'queue_progress' && b.queueDone === true)).toBe(true);
  });

  it('getOverallRating returns 10 on cache error', () => {
    const { orch, cache } = makeOrchestrator();
    jest.spyOn(cache, 'getAll').mockImplementation(() => { throw new Error('db error'); });
    expect(asInternals(orch).getOverallRating()).toBe(10);
  });

  it('getTotalFiles returns 0 on cache error', () => {
    const { orch, cache } = makeOrchestrator();
    jest.spyOn(cache, 'getAll').mockImplementation(() => { throw new Error('db error'); });
    expect(asInternals(orch).getTotalFiles()).toBe(0);
  });

  it('cleanup releases locks for active workers', () => {
    const { orch } = makeOrchestrator();
    const internals = asInternals(orch);
    const fakeTimeout = setTimeout(() => {}, 1_000_000);
    internals.activeWorkers.set('w1', {
      queueId: 1,
      filePath: '/repo/x.ts',
      promise: Promise.resolve(),
      startTime: Date.now(),
      timeout: fakeTimeout,
    });
    internals.cleanup();
    expect(internals.activeWorkers.size).toBe(0);
    clearTimeout(fakeTimeout);
  });

  it('cleanup clears timers and locks (callable directly)', () => {
    const { orch } = makeOrchestrator();
    expect(() => asInternals(orch).cleanup()).not.toThrow();
  });
});

describe('QualityOrchestrator.getTrends() with data', () => {
  beforeEach(() => { FixWorkerMock.mockClear(); });

  it('returns mapped trend data after a worker records a trend', async () => {
    const analyses = [{ path: '/repo/a.ts', rating: 4, repoRoot: '/repo' }];
    const { orch } = makeOrchestrator({ repos: ['/repo'] }, analyses);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await orch.enqueueRepos();
    const item = orch.getQueueItems()[0];

    await asInternals(orch).runWorker(item.id, item.filePath, 'w1', Date.now());

    const trends = orch.getTrends();
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0]).toEqual(expect.objectContaining({
      repo: expect.any(String),
      overallRating: expect.any(Number),
      filesTotal: expect.any(Number),
      filesPassed: expect.any(Number),
      filesFailed: expect.any(Number),
      filesPending: expect.any(Number),
      recordedAt: expect.any(Number),
    }));
  });
});

describe('QualityOrchestrator.getRepoSessionType()', () => {
  it('returns "unknown" for an unregistered repo path', () => {
    const { orch } = makeOrchestrator();
    expect(orch.getRepoSessionType('/nonexistent')).toBe('unknown');
  });

  it('returns the stored session type for a registered repo', () => {
    const { orch, cache } = makeOrchestrator();
    cache.saveRepository({
      id: 'repo-1',
      path: '/my-repo',
      name: 'my-repo',
      sessionType: 'claude',
      createdAt: Date.now(),
    });
    expect(orch.getRepoSessionType('/my-repo')).toBe('claude');
  });

  it('returns "unknown" when getRepositoryByPath throws', () => {
    const { orch, cache } = makeOrchestrator();
    jest.spyOn(cache, 'getRepositoryByPath').mockImplementation(() => { throw new Error('db error'); });
    expect(orch.getRepoSessionType('/any')).toBe('unknown');
    jest.restoreAllMocks();
  });
});

describe('QualityOrchestrator.getCmdForItem()', () => {
  beforeEach(() => { FixWorkerMock.mockClear(); });

  it('returns null for a non-existent item', () => {
    const { orch } = makeOrchestrator();
    expect(orch.getCmdForItem(999)).toBeNull();
  });

  it('returns claude command for a claude-session repo item', async () => {
    const analyses = [{ path: '/repo/a.ts', rating: 4, repoRoot: '/repo' }];
    const { orch, cache } = makeOrchestrator({ repos: ['/repo'] }, analyses);
    cache.saveRepository({
      id: 'repo-claude',
      path: '/repo',
      name: 'repo',
      sessionType: 'claude',
      createdAt: Date.now(),
    });
    await orch.enqueueRepos();
    const items = orch.getQueueItems();
    const result = orch.getCmdForItem(items[0].id);
    expect(result).not.toBeNull();
    expect(result!.sessionType).toBe('claude');
    expect(result!.cmd).toContain('claude');
  });

  it('returns github-copilot command for a copilot-session repo item', async () => {
    const analyses = [{ path: '/repo/a.ts', rating: 4, repoRoot: '/repo' }];
    const { orch, cache } = makeOrchestrator({ repos: ['/repo'] }, analyses);
    cache.saveRepository({
      id: 'repo-copilot',
      path: '/repo',
      name: 'repo',
      sessionType: 'github-copilot',
      createdAt: Date.now(),
    });
    await orch.enqueueRepos();
    const items = orch.getQueueItems();
    const result = orch.getCmdForItem(items[0].id);
    expect(result).not.toBeNull();
    expect(result!.sessionType).toBe('github-copilot');
    expect(result!.cmd).toContain('gh copilot');
  });
});

describe('QualityOrchestrator.executeItem() early returns', () => {
  it('returns error for a non-existent item', async () => {
    const { orch } = makeOrchestrator();
    const result = await orch.executeItem(999);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error for an item already in progress', async () => {
    const analyses = [{ path: '/repo/a.ts', rating: 4, repoRoot: '/repo' }];
    const { orch } = makeOrchestrator({ repos: ['/repo'] }, analyses);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await orch.enqueueRepos();
    const items = orch.getQueueItems();
    asInternals(orch).queue.markInProgress(items[0].id, 'test-wid');
    const result = await orch.executeItem(items[0].id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already in progress');
  });

  it('returns error when fix prompt generation fails (fetch rejects)', async () => {
    const analyses = [{ path: '/repo/a.ts', rating: 4, repoRoot: '/repo' }];
    const { orch } = makeOrchestrator({ repos: ['/repo'] }, analyses);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await orch.enqueueRepos();
    const items = orch.getQueueItems();
    const result = await orch.executeItem(items[0].id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not fetch analysis');
  });
});

describe('QualityOrchestrator.resolveClaudePath()', () => {
  afterEach(() => {
    jest.clearAllMocks();
    // Restore default implementations
    (fs.existsSync as jest.Mock).mockImplementation(jest.requireActual<typeof fs>('fs').existsSync);
    (cp.execSync as jest.Mock).mockImplementation(jest.requireActual<typeof cp>('child_process').execSync);
  });

  it('falls back to bare "claude" when no candidate is found and which fails', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (cp.execSync as jest.Mock).mockImplementation(() => { throw new Error('not found'); });

    const { orch } = makeOrchestrator();
    expect(asInternals(orch).resolveClaudePath()).toBe('claude');
  });

  it('returns the first candidate path that exists on disk', () => {
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => p === '/home/mohantn/.local/bin/claude');
    (cp.execSync as jest.Mock).mockImplementation(() => { throw new Error('not found'); });

    const { orch } = makeOrchestrator();
    expect(asInternals(orch).resolveClaudePath()).toBe('/home/mohantn/.local/bin/claude');
  });
});

describe('QualityOrchestrator.updateConfig — full field coverage', () => {
  it('applies every updatable field', () => {
    const { orch } = makeOrchestrator();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    orch.updateConfig({
      threshold: 9,
      maxWorkers: 6,
      maxAttemptsPerFile: 5,
      workerMode: 'api',
      repos: ['/x'],
      checkpointIntervalSec: 99,
      heartbeatIntervalSec: 7,
    });
    const cfg = orch.getConfig();
    expect(cfg.threshold).toBe(9);
    expect(cfg.maxWorkers).toBe(6);
    expect(cfg.maxAttemptsPerFile).toBe(5);
    expect(cfg.workerMode).toBe('api');
    expect(cfg.repos).toEqual(['/x']);
    expect(cfg.checkpointIntervalSec).toBe(99);
    expect(cfg.heartbeatIntervalSec).toBe(7);
  });
});
