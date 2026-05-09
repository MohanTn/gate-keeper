import * as path from 'path';
import * as fs from 'fs';
import { scan, scanRepo } from './viz-scanner';
import { SqliteCache } from '../cache/sqlite-cache';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { DependencyGraph } from '../graph/dependency-graph';
import { FileAnalysis, Config, WSMessage } from '../types';

describe('viz-scanner', () => {
  let cache: SqliteCache;
  let analyzer: UniversalAnalyzer;
  let testDbPath: string;
  let config: Config;
  let graphs: Map<string, DependencyGraph>;
  let broadcastCalls: WSMessage[];
  let logCalls: Array<{ msg: string; level?: string }>;
  let scanning = false;
  let tempDirs: string[] = [];

  const deps = () => ({
    cache, analyzer, config,
    workDir: process.cwd(),
    graphs,
    graphFor: (repo: string) => { if (!graphs.has(repo)) graphs.set(repo, new DependencyGraph()); return graphs.get(repo)!; },
    broadcast: (msg: WSMessage) => { broadcastCalls.push(msg); },
    appendScanLog: (msg: string, level?: string) => { logCalls.push({ msg, level }); },
    getScanning: () => scanning,
    setScanning: (v: boolean) => { scanning = v; },
  });

  beforeAll(() => { testDbPath = path.join(__dirname, '../../temp-scanner-' + Date.now() + '.db'); });

  beforeEach(() => {
    cache = new SqliteCache(testDbPath);
    analyzer = new UniversalAnalyzer();
    config = { minRating: 6.5, scanExcludePatterns: { global: [], csharp: [], typescript: [] } };
    graphs = new Map();
    broadcastCalls = [];
    logCalls = [];
    scanning = false;
    tempDirs = [];
  });

  afterEach(() => {
    cache.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('scan', () => {
    it('returns early when already scanning', async () => {
      scanning = true;
      await scan(deps());
      expect(scanning).toBe(true);
    });

    it('completes with 0 files', async () => {
      const testDir = path.join(__dirname, '../../temp-scanner-scan-' + Date.now());
      tempDirs.push(testDir);
      fs.mkdirSync(testDir, { recursive: true });

      const d = deps();
      d.workDir = testDir;

      await scan(d);
      expect(scanning).toBe(false);
      expect(broadcastCalls.some(c => c.type === 'scan_complete')).toBe(true);
    });

    it('scans supported files in workDir', async () => {
      const testDir = path.join(__dirname, '../../temp-scan-test-' + Date.now());
      tempDirs.push(testDir);
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'test.ts'), 'export const x = 1;\n');

      const d = deps();
      d.workDir = testDir;

      await scan(d);

      expect(scanning).toBe(false);
      expect(broadcastCalls.some(c => c.type === 'scan_start')).toBe(true);
      expect(broadcastCalls.some(c => c.type === 'scan_complete')).toBe(true);
    });
  });

  describe('scanRepo', () => {
    it('returns early when already scanning', async () => {
      scanning = true;
      await scanRepo(deps(), '/tmp/nonexistent');
      expect(scanning).toBe(true);
    });

    it('completes with 0 files for nonexistent dir', async () => {
      await scanRepo(deps(), '/tmp/gk-nonexistent-' + Date.now());
      expect(scanning).toBe(false);
      expect(logCalls.some(c => c.msg.includes('0 files'))).toBe(true);
    });

    it('scans files in repo root', async () => {
      const testDir = path.join(__dirname, '../../temp-repo-scan-' + Date.now());
      tempDirs.push(testDir);
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'a.ts'), 'export const a = 1;\n');
      fs.writeFileSync(path.join(testDir, 'b.ts'), 'export const b = 2;\n');

      await scanRepo(deps(), testDir);

      expect(scanning).toBe(false);
      expect(broadcastCalls.some(c => c.type === 'scan_start')).toBe(true);
      expect(broadcastCalls.some(c => c.type === 'scan_complete')).toBe(true);
    });

    it('skips cached files when not forced', async () => {
      const testDir = path.join(__dirname, '../../temp-repo-scan2-' + Date.now());
      tempDirs.push(testDir);
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'c.ts'), 'export const c = 1;\n');

      // First scan
      await scanRepo(deps(), testDir);
      expect(broadcastCalls.filter(c => c.type === 'scan_start').length).toBe(1);

      // Second scan should skip cached file
      broadcastCalls = [];
      await scanRepo(deps(), testDir);
      // No scan_start because no new files
      expect(broadcastCalls.some(c => c.type === 'scan_start')).toBe(false);
    });

    it('re-scans when forced', async () => {
      const testDir = path.join(__dirname, '../../temp-repo-scan3-' + Date.now());
      tempDirs.push(testDir);
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'd.ts'), 'export const d = 1;\n');

      await scanRepo(deps(), testDir);
      await scanRepo(deps(), testDir, true); // force

      expect(broadcastCalls.filter(c => c.type === 'scan_start').length).toBeGreaterThanOrEqual(2);
    });
  });
});
