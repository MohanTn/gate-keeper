import * as fs from 'fs';
import * as path from 'path';
import { VizServer } from './viz-server';
import { globToRegex, extToConfigLang, shouldExcludeFile } from './viz-helpers';
import { SqliteCache } from '../cache/sqlite-cache';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { FileAnalysis, Config } from '../types';

// Mock ws
jest.mock('ws', () => ({
  WebSocketServer: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    clients: new Set(),
    close: jest.fn(),
  })),
  WebSocket: jest.fn(),
}));

// Mock express - capture route handlers by route path
const captured: Record<string, Record<string, Function>> = {
  get: {}, post: {}, put: {}, delete: {},
};

const mockApp: any = {
  use: jest.fn(),
  get: jest.fn((route: string, handler: Function) => { captured.get[route] = handler; return mockApp; }),
  post: jest.fn((route: string, handler: Function) => { captured.post[route] = handler; return mockApp; }),
  put: jest.fn((route: string, handler: Function) => { captured.put[route] = handler; return mockApp; }),
  delete: jest.fn((route: string, handler: Function) => { captured.delete[route] = handler; return mockApp; }),
};

const mockServer = { listen: jest.fn((_p: number, cb: () => void) => cb()), close: jest.fn() };

jest.mock('express', () => {
  const fn = jest.fn(() => mockApp);
  (fn as any).json = jest.fn(() => jest.fn());
  (fn as any).static = jest.fn(() => jest.fn());
  (fn as any).urlencoded = jest.fn(() => jest.fn());
  return fn;
});
jest.mock('http', () => ({ createServer: jest.fn(() => mockServer) }));
jest.mock('open', () => jest.fn(() => Promise.resolve()));

function req(q: Record<string, unknown> = {}, b: Record<string, unknown> = {}, p: Record<string, unknown> = {}) {
  return { query: q, body: b, params: p };
}
function res() {
  const r: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), redirect: jest.fn().mockReturnThis() };
  return r;
}
function call(route: string, type: 'get' | 'post' | 'put' | 'delete', q: Record<string, unknown> = {}, b: Record<string, unknown> = {}, p: Record<string, unknown> = {}) {
  const handler = captured[type][route];
  const r = res();
  if (handler) handler(req(q, b, p), r);
  return r;
}

describe('VizServer', () => {
  let vizServer: VizServer;
  let cache: SqliteCache;
  let analyzer: UniversalAnalyzer;
  let testDbPath: string;
  let config: Config;

  beforeAll(() => { testDbPath = path.join(__dirname, '../../temp-viz-' + Date.now() + '.db'); });

  beforeEach(() => {
    jest.clearAllMocks();
    for (const t of ['get', 'post', 'put', 'delete'] as const) for (const k of Object.keys(captured[t])) delete captured[t][k];
    cache = new SqliteCache(testDbPath);
    analyzer = new UniversalAnalyzer();
    config = { minRating: 6.5, scanExcludePatterns: { global: [], csharp: [], typescript: [] } };
  });

  afterEach(() => {
    if (vizServer) vizServer.stop();
    cache.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const cf = path.join(process.env.HOME ?? '/tmp', '.gate-keeper', 'config.json');
    if (fs.existsSync(cf)) fs.unlinkSync(cf);
  });

  describe('constructor', () => {
    it('instantiates with dependencies', () => {
      vizServer = new VizServer(cache, analyzer, process.cwd(), process.cwd(), config);
      expect(vizServer).toBeInstanceOf(VizServer);
      expect(Object.keys(captured.get).length).toBeGreaterThan(0);
    });
    it('uses defaults', () => {
      vizServer = new VizServer(cache, analyzer);
      expect(vizServer).toBeInstanceOf(VizServer);
    });
    it('loads from cache', () => {
      cache.save({ path: '/x.ts', language: 'typescript', dependencies: [], metrics: { linesOfCode: 10, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 }, violations: [], rating: 8, analyzedAt: Date.now(), repoRoot: '/r' });
      vizServer = new VizServer(cache, analyzer, process.cwd(), '/r', config);
      expect((vizServer as any).mergedGraphData().nodes.length).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('starts', async () => {
      vizServer = new VizServer(cache, analyzer);
      await vizServer.start();
      expect(mockServer.listen).toHaveBeenCalled();
    });
    it('stops', async () => {
      vizServer = new VizServer(cache, analyzer);
      await vizServer.start();
      vizServer.stop();
      expect(mockServer.close).toHaveBeenCalled();
    });
  });

  describe('graph management', () => {
    it('creates per-repo graphs', () => {
      vizServer = new VizServer(cache, analyzer);
      expect((vizServer as any).graphFor('/a')).not.toBe((vizServer as any).graphFor('/b'));
    });
    it('returns same graph for same repo', () => {
      vizServer = new VizServer(cache, analyzer);
      const g = (vizServer as any).graphFor('/a');
      expect((vizServer as any).graphFor('/a')).toBe(g);
    });
    it('merges graphs', () => {
      cache.save({ path: '/a/x.ts', language: 'typescript', dependencies: [], metrics: { linesOfCode: 10, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 }, violations: [], rating: 8, analyzedAt: Date.now(), repoRoot: '/a' });
      cache.save({ path: '/b/y.ts', language: 'typescript', dependencies: [], metrics: { linesOfCode: 10, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 }, violations: [], rating: 7, analyzedAt: Date.now(), repoRoot: '/b' });
      vizServer = new VizServer(cache, analyzer);
      expect((vizServer as any).mergedGraphData().nodes.length).toBe(2);
    });
  });

  describe('pushAnalysis', () => {
    it('adds to graph', () => {
      vizServer = new VizServer(cache, analyzer, process.cwd(), '/r', config);
      const a: FileAnalysis = { path: '/x.ts', language: 'typescript', dependencies: [], metrics: { linesOfCode: 10, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 }, violations: [], rating: 7, analyzedAt: Date.now(), repoRoot: '/r' };
      vizServer.pushAnalysis(a);
      expect((vizServer as any).graphFor('/r').toGraphData().nodes.some((n: any) => n.id === '/x.ts')).toBe(true);
    });
  });

  describe('scan guard', () => {
    it('skips when scanning', async () => {
      vizServer = new VizServer(cache, analyzer);
      (vizServer as any).scanning = true;
      await vizServer.scan();
      expect((vizServer as any).scanning).toBe(true);
    });
    it('skips scanRepo when scanning', async () => {
      vizServer = new VizServer(cache, analyzer);
      (vizServer as any).scanning = true;
      await vizServer.scanRepo('/r');
      expect((vizServer as any).scanning).toBe(true);
    });
  });

  describe('broadcast', () => {
    it('handles no clients', () => {
      vizServer = new VizServer(cache, analyzer);
      expect(() => (vizServer as any).broadcast({ type: 'x' })).not.toThrow();
    });
    it('handles with filter', () => {
      vizServer = new VizServer(cache, analyzer);
      expect(() => (vizServer as any).broadcast({ type: 'x' }, '/r')).not.toThrow();
    });
  });

  describe('broadcastRepoCreated', () => {
    it('broadcasts', () => {
      vizServer = new VizServer(cache, analyzer);
      expect(() => vizServer.broadcastRepoCreated({ id: '1', path: '/r', name: 'R', sessionType: 'claude', createdAt: 1, isActive: true })).not.toThrow();
    });
  });

  describe('mergedOverallRating', () => {
    it('returns 10 when empty', () => {
      vizServer = new VizServer(cache, analyzer);
      expect((vizServer as any).mergedOverallRating()).toBe(10);
    });
    it('averages', () => {
      cache.save({ path: '/a/x.ts', language: 'typescript', dependencies: [], metrics: { linesOfCode: 10, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 }, violations: [], rating: 6, analyzedAt: Date.now(), repoRoot: '/a' });
      cache.save({ path: '/b/y.ts', language: 'typescript', dependencies: [], metrics: { linesOfCode: 10, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 0 }, violations: [], rating: 8, analyzedAt: Date.now(), repoRoot: '/b' });
      vizServer = new VizServer(cache, analyzer);
      expect((vizServer as any).mergedOverallRating()).toBe(7);
    });
  });

  describe('maybeAutoOpen', () => {
    it('skips when rating OK', () => {
      vizServer = new VizServer(cache, analyzer, process.cwd(), '/r', config);
      const g = (vizServer as any).graphFor('/r'); g.overallRating = () => 7.5;
      const o = require('open');
      (vizServer as any).maybeAutoOpen('/r');
      expect(o).not.toHaveBeenCalled();
    });
    it('opens when rating low', () => {
      vizServer = new VizServer(cache, analyzer, process.cwd(), '/r', config);
      const g = (vizServer as any).graphFor('/r'); g.overallRating = () => 3.5;
      const o = require('open');
      (vizServer as any).maybeAutoOpen('/r');
      expect(o).toHaveBeenCalled();
    });
    it('only once', () => {
      vizServer = new VizServer(cache, analyzer, process.cwd(), '/r', config);
      const g = (vizServer as any).graphFor('/r'); g.overallRating = () => 2;
      const o = require('open');
      (vizServer as any).maybeAutoOpen('/r');
      (vizServer as any).maybeAutoOpen('/r');
      expect(o).toHaveBeenCalledTimes(1);
    });
  });

  describe('appendScanLog', () => {
    it('adds entry', () => {
      vizServer = new VizServer(cache, analyzer);
      (vizServer as any).appendScanLog('hi', 'info');
      expect((vizServer as any).scanLogs[0].message).toBe('hi');
    });
    it('limits to 500', () => {
      vizServer = new VizServer(cache, analyzer);
      for (let i = 0; i < 510; i++) (vizServer as any).appendScanLog(`${i}`, 'info');
      expect((vizServer as any).scanLogs.length).toBe(500);
    });
    it('defaults to info', () => {
      vizServer = new VizServer(cache, analyzer);
      (vizServer as any).appendScanLog('hi');
      expect((vizServer as any).scanLogs[0].level).toBe('info');
    });
  });

  describe('getLiveConfig', () => {
    it('returns in-memory', () => {
      vizServer = new VizServer(cache, analyzer, process.cwd(), process.cwd(), config);
      expect((vizServer as any).getLiveConfig().minRating).toBe(6.5);
    });
    it('reads from file', () => {
      const d = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
      const f = path.join(d, 'config.json');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ minRating: 7 }));
      vizServer = new VizServer(cache, analyzer);
      expect((vizServer as any).getLiveConfig().minRating).toBe(7);
    });
    it('falls back on parse error', () => {
      const d = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
      const f = path.join(d, 'config.json');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(f, 'bad');
      vizServer = new VizServer(cache, analyzer, process.cwd(), process.cwd(), config);
      expect((vizServer as any).getLiveConfig().minRating).toBe(6.5);
    });
  });

  // ── Route handlers ──────────────────────────────────────
  describe('routes', () => {
    const seed = () => cache.save({ path: '/src/foo.ts', language: 'typescript', dependencies: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 }, violations: [], rating: 8, analyzedAt: Date.now(), repoRoot: '/test/repo' });

    beforeEach(() => { vizServer = new VizServer(cache, analyzer, process.cwd(), '/test/repo', config); seed(); });

    it('GET /', () => { const r = call('/', 'get'); expect(r.redirect).toHaveBeenCalled(); });
    it('GET /api/repos', () => { expect(call('/api/repos', 'get').json).toHaveBeenCalled(); });
    it('GET /api/graph', () => { call('/api/graph', 'get'); call('/api/graph', 'get', { repo: '/r' }); });
    it('GET /api/hotspots', () => { call('/api/hotspots', 'get'); call('/api/hotspots', 'get', { repo: '/r' }); });
    it('GET /api/trends bad', () => { expect(call('/api/trends', 'get').status).toHaveBeenCalledWith(400); });
    it('GET /api/trends ok', () => { expect(call('/api/trends', 'get', { file: '/src/foo.ts', repo: '/test/repo' }).json).toHaveBeenCalled(); });
    it('GET /api/status', () => { const r = call('/api/status', 'get'); expect(r.json).toHaveBeenCalled(); expect(r.json.mock.calls[0][0].running).toBe(true); });
    it('GET /api/status w/ repo', () => { call('/api/status', 'get', { repo: '/test/repo' }); });
    it('GET /api/cycles', () => { call('/api/cycles', 'get'); call('/api/cycles', 'get', { repo: '/r' }); });
    it('POST /api/scan', () => { expect(call('/api/scan', 'post', {}, {}).json).toHaveBeenCalled(); expect(call('/api/scan', 'post', {}, { repo: '/r' }).json).toHaveBeenCalled(); });
    it('POST /api/scan busy', () => {
      (vizServer as any).scanning = true;
      expect(call('/api/scan', 'post', {}, {}).status).toHaveBeenCalledWith(409);
    });
    it('GET /api/file-detail bad', () => { expect(call('/api/file-detail', 'get').status).toHaveBeenCalledWith(400); });
    it('GET /api/file-detail missing', () => { expect(call('/api/file-detail', 'get', { file: '/no.ts', repo: '/r' }).status).toHaveBeenCalledWith(404); });
    it('GET /api/file-detail ok', () => { expect(call('/api/file-detail', 'get', { file: '/src/foo.ts', repo: '/test/repo' }).json).toHaveBeenCalled(); });
    it('GET /api/positions bad', () => { expect(call('/api/positions', 'get').status).toHaveBeenCalledWith(400); });
    it('POST /api/positions bad', () => { expect(call('/api/positions', 'post', {}, {}).status).toHaveBeenCalledWith(400); });
    it('POST /api/positions ok', () => { expect(call('/api/positions', 'post', {}, { repo: '/r', nodeId: 'x', x: 1, y: 2 }).json).toHaveBeenCalled(); });
    it('POST /api/clear bad', () => { expect(call('/api/clear', 'post', {}, {}).status).toHaveBeenCalledWith(400); });
    it('POST /api/clear ok', () => { expect(call('/api/clear', 'post', {}, { repo: '/r' }).json).toHaveBeenCalled(); });
    it('DELETE /api/repos bad', () => { expect(call('/api/repos', 'delete', {}, {}).status).toHaveBeenCalledWith(400); });
    it('DELETE /api/repos ok', () => { expect(call('/api/repos', 'delete', {}, { repoRoot: '/r' }).json).toHaveBeenCalled(); });
    it('GET /api/exclude-patterns bad', () => { expect(call('/api/exclude-patterns', 'get').status).toHaveBeenCalledWith(400); });
    it('POST /api/exclude-patterns bad', () => { expect(call('/api/exclude-patterns', 'post', {}, {}).status).toHaveBeenCalledWith(400); });
    it('POST /api/exclude-patterns long', () => { expect(call('/api/exclude-patterns', 'post', {}, { repo: '/r', pattern: 'a'.repeat(201) }).status).toHaveBeenCalledWith(400); });
    it('POST /api/exclude-patterns ok', () => { expect(call('/api/exclude-patterns', 'post', {}, { repo: '/r', pattern: '**/*.gen.ts' }).json).toHaveBeenCalled(); });
    it('DELETE /api/exclude-patterns bad', () => { const r = res(); captured.delete['/api/exclude-patterns/:id']?.({ params: { id: 'x' } }, r); expect(r.status).toHaveBeenCalledWith(400); });
    it('GET /api/scan-config', () => { expect(call('/api/scan-config', 'get').json).toHaveBeenCalled(); });
    it('GET /api/scan-logs', () => { expect(call('/api/scan-logs', 'get').json).toHaveBeenCalled(); });
    it('GET /api/config', () => { expect(call('/api/config', 'get').json).toHaveBeenCalled(); });
    it('PUT /api/config ok', () => { expect(call('/api/config', 'put', {}, { minRating: 7.5 }).json).toHaveBeenCalled(); });
    it('PUT /api/config bad', () => { expect(call('/api/config', 'put', {}, { minRating: 99 }).status).toHaveBeenCalledWith(400); });
    it('GET /api/patterns', () => { expect(call('/api/patterns', 'get').json).toHaveBeenCalled(); });
  });

  describe('scan', () => {
    it('completes with 0 files', async () => {
      vizServer = new VizServer(cache, analyzer);
      await vizServer.scan();
      expect((vizServer as any).scanning).toBe(false);
    });
  });
});

describe('helper functions', () => {
  describe('globToRegex', () => {
    it('matches simple wildcard', () => {
      const re = globToRegex('**/*.test.ts');
      expect(re.test('/src/foo.test.ts')).toBe(true);
      expect(re.test('/src/foo.ts')).toBe(false);
    });
    it('matches single star', () => {
      const re = globToRegex('*.ts');
      expect(re.test('foo.ts')).toBe(true);
      expect(re.test('foo.js')).toBe(false);
    });
    it('escapes special chars', () => {
      const re = globToRegex('foo.bar');
      expect(re.test('foo.bar')).toBe(true);
      expect(re.test('fooXbar')).toBe(false);
    });
  });

  describe('extToConfigLang', () => {
    it('maps .cs', () => { expect(extToConfigLang('.cs')).toBe('csharp'); });
    it('maps .ts', () => { expect(extToConfigLang('.ts')).toBe('typescript'); });
    it('maps .tsx', () => { expect(extToConfigLang('.tsx')).toBe('typescript'); });
    it('maps .jsx', () => { expect(extToConfigLang('.jsx')).toBe('typescript'); });
    it('maps .js', () => { expect(extToConfigLang('.js')).toBe('typescript'); });
    it('returns null for unknown', () => { expect(extToConfigLang('.py')).toBeNull(); });
  });

  describe('shouldExcludeFile', () => {
    it('returns false when no patterns', () => {
      expect(shouldExcludeFile('/src/foo.ts', '.ts', undefined)).toBe(false);
    });
    it('excludes by global pattern', () => {
      expect(shouldExcludeFile('/src/foo.test.ts', '.ts', { global: ['**/*.test.ts'], csharp: [], typescript: [] })).toBe(true);
    });
    it('excludes by language pattern', () => {
      expect(shouldExcludeFile('/src/foo.spec.ts', '.ts', { global: [], csharp: [], typescript: ['**/*.spec.*'] })).toBe(true);
    });
    it('does not exclude when no match', () => {
      expect(shouldExcludeFile('/src/foo.ts', '.ts', { global: ['**/*.gen.*'], csharp: [], typescript: [] })).toBe(false);
    });
  });
});
