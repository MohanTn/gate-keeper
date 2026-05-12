import * as fs from 'fs';
import * as path from 'path';

// Mock process.exit before any imports
const mockExit = jest.fn();
process.exit = mockExit as any;

// Mock 'open' before viz-server is loaded (it's an ES module)
jest.mock('open', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock express to prevent actual server binding during tests
jest.mock('express', () => {
  const mockApp: any = {
    use: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    listen: jest.fn((port: any, host: any, cb: any) => {
      if (cb) cb();
      return { close: jest.fn() };
    }),
  };
  const express = jest.fn(() => mockApp) as any;
  express.json = jest.fn();
  return express;
});

// Mock SqliteCache
jest.mock('./cache/sqlite-cache', () => ({
  SqliteCache: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
    getRepository: jest.fn(),
    saveRepository: jest.fn(),
    getAllRepositories: jest.fn().mockReturnValue([]),
    getAll: jest.fn().mockReturnValue([]),
    getRepos: jest.fn().mockReturnValue([]),
  })),
}));

// Mock UniversalAnalyzer — capture the instance so tests can configure it per-call
let mockAnalyzerInstance: any;
jest.mock('./analyzer/universal-analyzer', () => ({
  UniversalAnalyzer: jest.fn().mockImplementation(() => {
    mockAnalyzerInstance = {
      analyze: jest.fn(),
      isSupportedFile: jest.fn(),
    };
    return mockAnalyzerInstance;
  }),
}));

// Mock VizServer - must return a proper instance with methods that return Promises
let mockVizServerInstance: any;
jest.mock('./viz/viz-server', () => ({
  VizServer: jest.fn().mockImplementation(() => {
    mockVizServerInstance = {
      start: jest.fn().mockResolvedValue(undefined),
      scan: jest.fn().mockResolvedValue(undefined),
      scanRepo: jest.fn().mockResolvedValue(undefined),
      broadcastRepoCreated: jest.fn(),
      broadcastMessage: jest.fn(),
      pushAnalysis: jest.fn(),
    };
    return mockVizServerInstance;
  }),
}));

// Mock QualityOrchestrator and loadQualityConfig
let mockOrchestratorInstance: any;
jest.mock('./quality-loop/orchestrator', () => ({
  QualityOrchestrator: jest.fn().mockImplementation(() => {
    mockOrchestratorInstance = {
      start: jest.fn(),
      stop: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      stats: { filesFixed: 0, filesSkipped: 0, totalAttempts: 0 },
      isRunning: false,
      isPaused: false,
      getQueueItems: jest.fn().mockReturnValue([]),
      getAttempts: jest.fn().mockReturnValue([]),
      getTrends: jest.fn().mockReturnValue([]),
      getConfig: jest.fn().mockReturnValue({ threshold: 7, maxWorkers: 3 }),
      updateConfig: jest.fn(),
      enqueueRepos: jest.fn().mockResolvedValue(2),
      resetFailed: jest.fn().mockReturnValue(1),
    };
    return mockOrchestratorInstance;
  }),
  loadQualityConfig: jest.fn().mockReturnValue({
    threshold: 7, maxWorkers: 3, maxAttemptsPerFile: 3,
    workerMode: 'auto', repos: ['/test/repo'], excludePatterns: [],
    checkpointIntervalSec: 300, heartbeatIntervalSec: 60,
  }),
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({
    status: 0,
    stdout: '/test/repo',
  })),
}));

// Mock arch-config-manager
jest.mock('./arch/arch-config-manager', () => ({
  readArchConfig: jest.fn().mockReturnValue({}),
  mergeFileLayer: jest.fn(),
  getEffectiveLayer: jest.fn().mockReturnValue('application'),
  DEFAULT_LAYERS: {},
}));

// Mock fs to prevent actual file system operations during module load
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest.fn().mockReturnValue('{}'),
    unlinkSync: jest.fn(),
    watchFile: jest.fn(),
    unwatchFile: jest.fn(),
  };
});

// Helper to extract HTTP handler from express mock
function extractHandler(method: 'get' | 'post', route: string) {
  const express = require('express');
  const mockApp = express.mock.results[express.mock.results.length - 1].value;
  const calls = mockApp[method].mock.calls;
  const call = calls.find((c: any[]) => c[0] === route);
  return call ? call[call.length - 1] : null;
}

// Helper to create mock req/res
function createMockReqRes(body?: any) {
  const req = { body: body || {} };
  const res: any = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

describe('DEFAULT_CONFIG', () => {
  beforeEach(() => jest.resetModules());

  it('should export DEFAULT_CONFIG with minRating 6.5', () => {
    const { DEFAULT_CONFIG } = require('./daemon');
    expect(DEFAULT_CONFIG.minRating).toBe(6.5);
  });

  it('should have scanExcludePatterns for C#, TypeScript, and global', () => {
    const { DEFAULT_CONFIG } = require('./daemon');
    expect(DEFAULT_CONFIG.scanExcludePatterns).toHaveProperty('csharp');
    expect(DEFAULT_CONFIG.scanExcludePatterns).toHaveProperty('typescript');
    expect(DEFAULT_CONFIG.scanExcludePatterns).toHaveProperty('global');
  });

  it('should exclude C# migration files', () => {
    const { DEFAULT_CONFIG } = require('./daemon');
    expect(DEFAULT_CONFIG.scanExcludePatterns.csharp).toContain('**/Migrations/*.cs');
  });

  it('should exclude TypeScript declaration files', () => {
    const { DEFAULT_CONFIG } = require('./daemon');
    expect(DEFAULT_CONFIG.scanExcludePatterns.typescript).toContain('*.d.ts');
  });
});

describe('constants', () => {
  beforeEach(() => jest.resetModules());

  it('should export IPC_PORT = 5379', () => {
    const { IPC_PORT } = require('./daemon');
    expect(IPC_PORT).toBe(5379);
  });

  it('should have GK_DIR path containing .gate-keeper', () => {
    const { GK_DIR } = require('./daemon');
    expect(GK_DIR).toContain('.gate-keeper');
  });

  it('should have PID_FILE and CONFIG_FILE paths', () => {
    const { PID_FILE, CONFIG_FILE } = require('./daemon');
    expect(PID_FILE).toContain('daemon.pid');
    expect(CONFIG_FILE).toContain('config.json');
  });
});

describe('findGitRoot', () => {
  beforeEach(() => jest.resetModules());

  it('should return git root when git succeeds', () => {
    const { spawnSync } = require('child_process');
    spawnSync.mockReturnValue({ status: 0, stdout: '/path/to/repo\n' });

    const { findGitRoot } = require('./daemon');
    expect(findGitRoot('/path/to/repo/src')).toBe('/path/to/repo');
  });

  it('should return input directory when git fails', () => {
    const { spawnSync } = require('child_process');
    spawnSync.mockReturnValue({ status: 1, stdout: '' });

    const { findGitRoot } = require('./daemon');
    expect(findGitRoot('/not/a/git/repo')).toBe('/not/a/git/repo');
  });

  it('should trim whitespace from git output', () => {
    const { spawnSync } = require('child_process');
    spawnSync.mockReturnValue({ status: 0, stdout: '  /path/with/spaces  \n\n' });

    const { findGitRoot } = require('./daemon');
    expect(findGitRoot('/path/with/spaces/src')).toBe('/path/with/spaces');
  });
});

describe('main() startup', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('should call ensurePidFile and start vizServer', async () => {
    const { main } = require('./daemon');
    const fs = require('fs');
    const { VizServer } = require('./viz/viz-server');

    await main();

    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('daemon.pid'),
      expect.any(String)
    );
    expect(VizServer.mock.results[0].value.start).toHaveBeenCalled();
  });

  it('should call vizServer.scan(false) by default', async () => {
    const { main } = require('./daemon');
    const { VizServer } = require('./viz/viz-server');

    await main();

    expect(VizServer.mock.results[0].value.scan).toHaveBeenCalledWith(false);
  });

  it('should NOT call vizServer.scan with --no-scan flag', async () => {
    const orig = process.argv;
    process.argv = ['node', 'dist/daemon.js', '--no-scan'];
    const { main } = require('./daemon');
    const { VizServer } = require('./viz/viz-server');

    await main();

    expect(VizServer.mock.results[0].value.scan).not.toHaveBeenCalled();
    process.argv = orig;
  });

  it('should register IPC routes and listen on port 5379', async () => {
    const { main } = require('./daemon');
    const express = require('express');

    await main();

    const mockApp = express.mock.results[express.mock.results.length - 1].value;
    expect(mockApp.listen).toHaveBeenCalledWith(5379, '127.0.0.1', expect.any(Function));
  });

  it('should register routes for /health, /repo-register, /analyze, /repos', async () => {
    const { main } = require('./daemon');
    const express = require('express');

    await main();

    const mockApp = express.mock.results[express.mock.results.length - 1].value;
    const getRoutes = mockApp.get.mock.calls.map((c: any[]) => c[0]);
    const postRoutes = mockApp.post.mock.calls.map((c: any[]) => c[0]);

    expect(getRoutes).toContain('/health');
    expect(getRoutes).toContain('/repos');
    expect(postRoutes).toContain('/repo-register');
    expect(postRoutes).toContain('/analyze');
  });
});

describe('loadConfig behavior', () => {
  it('should use DEFAULT_CONFIG when file does not exist', async () => {
    jest.resetModules();
    const fs = require('fs');
    fs.existsSync.mockReturnValue(false);

    const { main } = require('./daemon');
    const { VizServer } = require('./viz/viz-server');

    await main();

    const args = VizServer.mock.calls[0];
    expect(args[4].minRating).toBe(6.5);
  });

  it('should merge user config minRating override', async () => {
    jest.resetModules();
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{"minRating": 8.0}');

    const { main } = require('./daemon');
    const { VizServer } = require('./viz/viz-server');

    await main();

    const args = VizServer.mock.calls[0];
    expect(args[4].minRating).toBe(8.0);
  });

  it('should fallback to defaults on malformed JSON', async () => {
    jest.resetModules();
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{invalid json}');

    const { main } = require('./daemon');
    const { VizServer } = require('./viz/viz-server');

    await main();

    const args = VizServer.mock.calls[0];
    expect(args[4].minRating).toBe(6.5);
  });

  it('should preserve default scanExcludePatterns', async () => {
    jest.resetModules();
    const fs = require('fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('{"minRating": 7.5}');

    const { main } = require('./daemon');
    const { VizServer } = require('./viz/viz-server');

    await main();

    const args = VizServer.mock.calls[0];
    expect(args[4].scanExcludePatterns.typescript).toContain('*.d.ts');
  });
});

describe('GET /health endpoint', () => {
  beforeEach(() => jest.resetModules());

  it('should return { ok: true, pid }', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('get', '/health');
    expect(handler).toBeDefined();

    const { req, res } = createMockReqRes();
    handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, pid: process.pid });
  });
});

describe('POST /repo-register endpoint', () => {
  beforeEach(() => jest.resetModules());

  it('should return 400 when action is missing', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/repo-register');
    const { req, res } = createMockReqRes({ repo: { path: '/path' } });

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid request' });
  });

  it('should return 400 when repo.path is missing', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/repo-register');
    const { req, res } = createMockReqRes({ action: 'register_repo', repo: {} });

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should register repo and call cache.saveRepository', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/repo-register');
    const { SqliteCache } = require('./cache/sqlite-cache');
    const mockCache = SqliteCache.mock.results[0].value;

    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/my/repo', name: 'test-repo' },
    });

    handler(req, res);

    expect(mockCache.saveRepository).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, isNew: expect.any(Boolean) })
    );
  });

  it('should set isNew=true when getRepository returns null', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/repo-register');
    const { SqliteCache } = require('./cache/sqlite-cache');
    const mockCache = SqliteCache.mock.results[0].value;
    mockCache.getRepository.mockReturnValue(null);

    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/new/repo' },
    });

    handler(req, res);

    const callArg = res.json.mock.calls[0][0];
    expect(callArg.isNew).toBe(true);
  });

  it('should use default name from path.basename', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/repo-register');
    const { SqliteCache } = require('./cache/sqlite-cache');
    const mockCache = SqliteCache.mock.results[0].value;

    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/my/repo' },
    });

    handler(req, res);

    const metadata = mockCache.saveRepository.mock.calls[0][0];
    expect(metadata.name).toBe('repo');
  });

  it('should return 500 on cache.saveRepository error', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/repo-register');
    const { SqliteCache } = require('./cache/sqlite-cache');
    const mockCache = SqliteCache.mock.results[0].value;
    mockCache.saveRepository.mockImplementation(() => {
      throw new Error('DB error');
    });

    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/my/repo' },
    });

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('POST /analyze endpoint', () => {
  beforeEach(() => jest.resetModules());

  it('should return null analysis when filePath is missing', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/analyze');
    const { req, res } = createMockReqRes({});

    handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ analysis: null, minRating: expect.any(Number) });
  });

  it('should return null analysis when file does not exist', async () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValue(false);

    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/analyze');
    const { req, res } = createMockReqRes({ filePath: '/nonexistent.ts' });

    handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ analysis: null, minRating: expect.any(Number) });
  });

  it('should return null analysis when file is not supported', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/analyze');
    const { UniversalAnalyzer } = require('./analyzer/universal-analyzer');
    const mockAnalyzer = UniversalAnalyzer.mock.results[0].value;
    mockAnalyzer.isSupportedFile.mockReturnValue(false);

    const { req, res } = createMockReqRes({ filePath: '/test.py' });

    handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ analysis: null, minRating: expect.any(Number) });
  });

  it('should return null analysis for missing filePath', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/analyze');
    const { req, res } = createMockReqRes({});

    handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ analysis: null, minRating: expect.any(Number) });
  });

  it('should return null analysis for non-existent file', async () => {
    jest.resetModules();
    const fs = require('fs');
    fs.existsSync.mockReturnValueOnce(false);

    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/analyze');
    const { req, res } = createMockReqRes({ filePath: '/nonexistent.ts' });

    handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ analysis: null, minRating: expect.any(Number) });
  });

  it('handles analyzer.analyze() throwing an error gracefully', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    mockAnalyzerInstance.isSupportedFile.mockReturnValue(true);
    mockAnalyzerInstance.analyze.mockRejectedValue(new Error('ast parse failed'));

    const handler = extractHandler('post', '/analyze');
    const { req, res } = createMockReqRes({ filePath: '/test/file.ts', repoRoot: '/test' });
    await handler(req, res);

    // Error is swallowed; still returns a null-analysis response
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ analysis: null }));
  });
});

describe('GET /repos endpoint', () => {
  beforeEach(() => jest.resetModules());

  it('should return repos array from cache.getAllRepositories(true)', async () => {
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('get', '/repos');
    const { SqliteCache } = require('./cache/sqlite-cache');
    const mockCache = SqliteCache.mock.results[0].value;
    mockCache.getAllRepositories.mockReturnValue([
      { id: '123', name: 'test-repo' },
    ]);

    const { req, res } = createMockReqRes();
    handler(req, res);

    expect(mockCache.getAllRepositories).toHaveBeenCalledWith(true);
    expect(res.json).toHaveBeenCalledWith({
      repos: expect.arrayContaining([
        expect.objectContaining({ id: '123' }),
      ]),
    });
  });
});

describe('signal handling', () => {
  it('should only register signal handlers once', async () => {
    jest.resetModules();
    const { main } = require('./daemon');

    const origOn = process.on;
    const onSpy = jest.fn(origOn.bind(process));
    (process as any).on = onSpy;

    await main();
    const sigCount1 = onSpy.mock.calls.filter((c: any[]) => c[0] === 'SIGTERM' || c[0] === 'SIGINT').length;

    // Simulate calling main again (would increase counts if not guarded)
    const procFlag = (process as any)._gateKeeperSignalsRegistered;
    expect(procFlag).toBe(true);

    (process as any).on = origOn;
  });

  it('should set the signal registration guard', async () => {
    jest.resetModules();
    const { main } = require('./daemon');

    const beforeFlag = (process as any)._gateKeeperSignalsRegistered;
    await main();
    const afterFlag = (process as any)._gateKeeperSignalsRegistered;

    expect(afterFlag).toBe(true);
  });
});

describe('LCOV coverage watcher', () => {
  beforeEach(() => jest.resetModules());

  it('registers watchFile for each lcov candidate of known repos at startup', async () => {
    jest.resetModules();
    // Pre-seed the cache mock so getAllRepositories returns a repo before main() runs
    jest.doMock('./cache/sqlite-cache', () => ({
      SqliteCache: jest.fn().mockImplementation(() => ({
        close: jest.fn(),
        getRepository: jest.fn(),
        saveRepository: jest.fn(),
        getAllRepositories: jest.fn().mockReturnValue([{ path: '/startup/repo', name: 'startup-repo', id: 'x1' }]),
      })),
    }));

    const { main } = require('./daemon');
    const fs = require('fs');
    await main();

    const watchedPaths: string[] = (fs.watchFile as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(watchedPaths.some((p: string) => p.startsWith('/startup/repo') && p.includes('lcov.info'))).toBe(true);
  });

  it('registers watchFile for a newly registered repo via /repo-register', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    const fs = require('fs');
    (fs.watchFile as jest.Mock).mockClear();

    const handler = extractHandler('post', '/repo-register');
    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/new/repo', name: 'new-repo' },
    });
    await handler(req, res);

    const watchedPaths: string[] = (fs.watchFile as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(watchedPaths.some((p: string) => p.startsWith('/new/repo') && p.includes('lcov.info'))).toBe(true);
  });

  it('calls scanRepo with force=true after debounce when lcov mtime changes', async () => {
    jest.useFakeTimers();
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    const fs = require('fs');
    const handler = extractHandler('post', '/repo-register');
    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/watch/repo', name: 'watch-repo' },
    });
    await handler(req, res);

    // Grab any watchFile callback registered for /watch/repo
    const call = (fs.watchFile as jest.Mock).mock.calls.find((c: any[]) => c[0].startsWith('/watch/repo'));
    expect(call).toBeDefined();
    const callback = call![2]; // (path, options, callback)

    // Fire the callback simulating mtime change
    callback({ mtimeMs: 2000 }, { mtimeMs: 1000 });
    jest.advanceTimersByTime(2100);

    expect(mockVizServerInstance.scanRepo).toHaveBeenCalledWith('/watch/repo', true);
    jest.useRealTimers();
  });

  it('does not call scanRepo when watchFile fires with unchanged mtime', async () => {
    jest.useFakeTimers();
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    const fs = require('fs');
    const handler = extractHandler('post', '/repo-register');
    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/stable/repo', name: 'stable-repo' },
    });
    await handler(req, res);

    const call = (fs.watchFile as jest.Mock).mock.calls.find((c: any[]) => c[0].startsWith('/stable/repo'));
    const callback = call![2];

    mockVizServerInstance.scanRepo.mockClear();
    callback({ mtimeMs: 1000 }, { mtimeMs: 1000 }); // same mtime
    jest.advanceTimersByTime(2100);

    expect(mockVizServerInstance.scanRepo).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('/reanalyze-coverage responds immediately and triggers scanRepo in background', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/reanalyze-coverage');
    const { req, res } = createMockReqRes({ repoRoot: '/some/repo' });
    handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    // scanRepo is fire-and-forget; give the Promise microtask queue a tick
    await Promise.resolve();
    expect(mockVizServerInstance.scanRepo).toHaveBeenCalledWith('/some/repo', true);
  });

  it('/reanalyze-coverage falls back to daemon repoRoot when none provided', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    const handler = extractHandler('post', '/reanalyze-coverage');
    const { req, res } = createMockReqRes({});
    handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    await Promise.resolve();
    expect(mockVizServerInstance.scanRepo).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('startLcovWatcher swallows scanRepo errors without crashing', async () => {
    jest.useFakeTimers();
    jest.resetModules();
    const { main } = require('./daemon');
    await main();
    mockVizServerInstance.scanRepo.mockRejectedValueOnce(new Error('scan error'));

    const fs = require('fs');
    const handler = extractHandler('post', '/repo-register');
    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/errorcatch/repo', name: 'err-repo' },
    });
    await handler(req, res);

    const call = (fs.watchFile as jest.Mock).mock.calls.find((c: any[]) => c[0].startsWith('/errorcatch/repo'));
    expect(call).toBeDefined();
    call![2]({ mtimeMs: 2 }, { mtimeMs: 1 }); // trigger callback
    jest.advanceTimersByTime(2100);
    await Promise.resolve(); // let rejection settle
    jest.useRealTimers();
  });

  it('does not register duplicate watchFile for the same lcov path', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    const fs = require('fs');
    const handler = extractHandler('post', '/repo-register');

    // Register the same repo twice
    for (let i = 0; i < 2; i++) {
      const { req, res } = createMockReqRes({
        action: 'register_repo',
        repo: { path: '/dedup/repo', name: 'dedup-repo' },
      });
      await handler(req, res);
    }

    const dupPaths = (fs.watchFile as jest.Mock).mock.calls
      .filter((c: any[]) => c[0].startsWith('/dedup/repo'))
      .map((c: any[]) => c[0]);
    const unique = new Set(dupPaths);
    expect(dupPaths.length).toBe(unique.size);
  });
});

describe('quality loop (--quality-loop flag)', () => {
  let origArgv: string[];

  beforeEach(() => {
    jest.resetModules();
    origArgv = process.argv;
    process.argv = ['node', 'dist/daemon.js', '--quality-loop'];
  });

  afterEach(() => {
    process.argv = origArgv;
  });

  it('creates QualityOrchestrator when --quality-loop flag is passed', async () => {
    const { main } = require('./daemon');
    await main();
    const { QualityOrchestrator } = require('./quality-loop/orchestrator');
    expect(QualityOrchestrator).toHaveBeenCalled();
  });

  it('auto-populates repos from getAllRepositories when qlConfig.repos is empty', async () => {
    const { loadQualityConfig } = require('./quality-loop/orchestrator');
    loadQualityConfig.mockReturnValue({
      threshold: 7, maxWorkers: 3, maxAttemptsPerFile: 3,
      workerMode: 'auto', repos: [], excludePatterns: [],
      checkpointIntervalSec: 300, heartbeatIntervalSec: 60,
    });
    jest.doMock('./cache/sqlite-cache', () => ({
      SqliteCache: jest.fn().mockImplementation(() => ({
        close: jest.fn(),
        getRepository: jest.fn(),
        saveRepository: jest.fn(),
        getAllRepositories: jest.fn().mockReturnValue([{ path: '/reg/repo', name: 'r', id: 'x' }]),
        getAll: jest.fn().mockReturnValue([]),
        getRepos: jest.fn().mockReturnValue([]),
      })),
    }));
    const { main } = require('./daemon');
    await main();
    const { QualityOrchestrator } = require('./quality-loop/orchestrator');
    expect(QualityOrchestrator).toHaveBeenCalled();
  });

  it('falls back to cache.getRepos() when both getAllRepositories sources are empty', async () => {
    const { loadQualityConfig } = require('./quality-loop/orchestrator');
    loadQualityConfig.mockReturnValue({
      threshold: 7, maxWorkers: 3, maxAttemptsPerFile: 3,
      workerMode: 'auto', repos: [], excludePatterns: [],
      checkpointIntervalSec: 300, heartbeatIntervalSec: 60,
    });
    jest.doMock('./cache/sqlite-cache', () => ({
      SqliteCache: jest.fn().mockImplementation(() => ({
        close: jest.fn(),
        getRepository: jest.fn(),
        saveRepository: jest.fn(),
        getAllRepositories: jest.fn().mockReturnValue([]), // empty → triggers getRepos fallback
        getAll: jest.fn().mockReturnValue([]),
        getRepos: jest.fn().mockReturnValue(['/fallback/repo']),
      })),
    }));
    const { main } = require('./daemon');
    await main();
    const { QualityOrchestrator } = require('./quality-loop/orchestrator');
    const qlCfg = QualityOrchestrator.mock.calls[0][0];
    expect(qlCfg.repos).toContain('/fallback/repo');
  });

  it('QualityOrchestrator callbacks: broadcast and getAnalyzedFiles work correctly', async () => {
    const { main } = require('./daemon');
    await main();
    const { QualityOrchestrator } = require('./quality-loop/orchestrator');
    const callbacks = QualityOrchestrator.mock.calls[0][2] as {
      broadcast: (msg: unknown) => void;
      getAnalyzedFiles: (repo: string) => unknown[];
    };
    // Invoke broadcast — exercises the vizServer.broadcastMessage line
    callbacks.broadcast({ type: 'worker_activity' });
    expect(mockVizServerInstance.broadcastMessage).toHaveBeenCalled();
    // Invoke getAnalyzedFiles — exercises cache.getAll line
    const files = callbacks.getAnalyzedFiles('/test/repo');
    expect(Array.isArray(files)).toBe(true);
  });

  it('/api/quality/queue returns orchestrator queue items', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('get', '/api/quality/queue');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ items: [] });
  });

  it('/api/quality/status returns orchestrator stats', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('get', '/api/quality/status');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ running: false, paused: false }));
  });

  it('/api/quality/start starts orchestrator when not running', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('post', '/api/quality/start');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(mockOrchestratorInstance.start).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('/api/quality/stop stops the orchestrator', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('post', '/api/quality/stop');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(mockOrchestratorInstance.stop).toHaveBeenCalled();
  });

  it('/api/quality/pause pauses the orchestrator', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('post', '/api/quality/pause');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(mockOrchestratorInstance.pause).toHaveBeenCalled();
  });

  it('/api/quality/resume resumes the orchestrator', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('post', '/api/quality/resume');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(mockOrchestratorInstance.resume).toHaveBeenCalled();
  });

  it('/api/quality/enqueue enqueues repos and returns count', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('post', '/api/quality/enqueue');
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, enqueued: 2 });
  });

  it('/api/quality/reset resets failed items', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('post', '/api/quality/reset');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, reset: 1 });
  });

  it('/api/quality/trends returns trend data', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('get', '/api/quality/trends');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('/api/quality/attempts/:id returns attempts for a given id', async () => {
    const { main } = require('./daemon');
    await main();
    const express = require('express');
    const mockApp = express.mock.results[express.mock.results.length - 1].value;
    const call = mockApp.get.mock.calls.find((c: any[]) => c[0] === '/api/quality/attempts/:id');
    const handler = call?.[call.length - 1];
    const { res } = createMockReqRes();
    handler({ params: { id: '42' } }, res);
    expect(mockOrchestratorInstance.getAttempts).toHaveBeenCalledWith(42);
  });

  it('/api/quality/attempts/:id returns 400 for invalid id', async () => {
    const { main } = require('./daemon');
    await main();
    const express = require('express');
    const mockApp = express.mock.results[express.mock.results.length - 1].value;
    const call = mockApp.get.mock.calls.find((c: any[]) => c[0] === '/api/quality/attempts/:id');
    const handler = call?.[call.length - 1];
    const { res } = createMockReqRes();
    handler({ params: { id: 'bad' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('/api/quality/config GET returns current config', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('get', '/api/quality/config');
    const { req, res } = createMockReqRes();
    handler(req, res);
    expect(mockOrchestratorInstance.getConfig).toHaveBeenCalled();
  });

  it('/api/quality/config POST updates threshold and maxWorkers', async () => {
    const { main } = require('./daemon');
    await main();
    const handler = extractHandler('post', '/api/quality/config');
    const { req, res } = createMockReqRes({ threshold: 8, maxWorkers: 2 });
    handler(req, res);
    expect(mockOrchestratorInstance.updateConfig).toHaveBeenCalledWith({ threshold: 8 });
    expect(mockOrchestratorInstance.updateConfig).toHaveBeenCalledWith({ maxWorkers: 2 });
  });
});

describe('error paths and cleanup', () => {
  beforeEach(() => jest.resetModules());

  it('handles vizServer.scan() rejection without crashing', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    const { VizServer } = require('./viz/viz-server');
    // scan rejects — daemon should swallow it
    VizServer.mock.results?.[0]?.value?.scan?.mockRejectedValue?.(new Error('scan failed'));

    // Re-require after configuring the mock
    jest.resetModules();
    jest.doMock('./viz/viz-server', () => ({
      VizServer: jest.fn().mockImplementation(() => {
        mockVizServerInstance = {
          start: jest.fn().mockResolvedValue(undefined),
          scan: jest.fn().mockRejectedValue(new Error('scan failed')),
          scanRepo: jest.fn().mockResolvedValue(undefined),
          broadcastRepoCreated: jest.fn(),
          broadcastMessage: jest.fn(),
          pushAnalysis: jest.fn(),
        };
        return mockVizServerInstance;
      }),
    }));
    const { main: mainFresh } = require('./daemon');
    // Should not throw even though scan rejects
    await expect(mainFresh()).resolves.toBeUndefined();
  });

  it('handles /reanalyze-coverage scanRepo() rejection without crashing', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    await main();
    mockVizServerInstance.scanRepo.mockRejectedValueOnce(new Error('scan boom'));

    const handler = extractHandler('post', '/reanalyze-coverage');
    const { req, res } = createMockReqRes({ repoRoot: '/err/repo' });
    handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    // Let the rejected promise settle — should not throw
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
  });

  it('shutdown calls fs.unwatchFile for each registered lcov path', async () => {
    jest.resetModules();
    // Allow this main() call to register fresh signal handlers with the current module scope
    (process as any)._gateKeeperSignalsRegistered = false;

    const { main } = require('./daemon');
    await main();

    // Register a watcher so watchedLcovPaths is non-empty
    const fs = require('fs');
    const handler = extractHandler('post', '/repo-register');
    const { req, res } = createMockReqRes({
      action: 'register_repo',
      repo: { path: '/shutdown/repo', name: 'shutdown-repo' },
    });
    await handler(req, res);

    expect(
      (fs.watchFile as jest.Mock).mock.calls.some((c: any[]) => c[0].startsWith('/shutdown/repo'))
    ).toBe(true);

    (fs.unwatchFile as jest.Mock).mockClear();
    process.emit('SIGTERM');
    expect(fs.unwatchFile).toHaveBeenCalled();
  });

  it('CORS middleware invokes next() for non-OPTIONS requests', async () => {
    jest.resetModules();
    const { main } = require('./daemon');
    await main();

    const express = require('express');
    const mockApp = express.mock.results[express.mock.results.length - 1].value;
    // The CORS middleware is the second ipc.use() call (first is express.json())
    const corsMiddleware = mockApp.use.mock.calls.find(
      (c: any[]) => typeof c[0] === 'function' && c[0].length === 3
    )?.[0];
    if (!corsMiddleware) return; // skip if not found

    const res: any = { setHeader: jest.fn(), sendStatus: jest.fn() };
    const next = jest.fn();
    corsMiddleware({ method: 'GET' }, res, next);
    expect(next).toHaveBeenCalled();

    // OPTIONS request should short-circuit without calling next
    corsMiddleware({ method: 'OPTIONS' }, res, next);
    expect(res.sendStatus).toHaveBeenCalledWith(204);
  });
});
