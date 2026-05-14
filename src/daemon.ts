/**
 * gate-keeper daemon
 *
 * Listens on port 5379 for file paths from the hook-receiver, runs analysis,
 * updates the SQLite cache, and broadcasts results to the dashboard (port 5378).
 *
 * Start with: node dist/daemon.js
 */

import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { UniversalAnalyzer } from './analyzer/universal-analyzer';
import { SqliteCache } from './cache/sqlite-cache';
import { VizServer } from './viz/viz-server';
import { Config, DaemonRequest, RepoMetadata } from './types';
import { QualityOrchestrator, loadQualityConfig } from './quality-loop/orchestrator';
import { mergeFileLayer, getEffectiveLayer, readArchConfig, DEFAULT_LAYERS } from './arch/arch-config-manager';
import { WatchMode } from './daemon/watch-mode';

declare global {
  namespace NodeJS {
    interface Process {
      _gateKeeperSignalsRegistered?: boolean;
    }
  }
}

export const IPC_PORT = 5379;
export const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
export const PID_FILE = path.join(GK_DIR, 'daemon.pid');
export const CONFIG_FILE = path.join(GK_DIR, 'config.json');

export const DEFAULT_CONFIG: Config = {
  minRating: 6.5,
  scanExcludePatterns: {
    global: [],
    csharp: [
      '**/Migrations/*.cs',
      '**/Migrations/**/*.cs',
      '*.Designer.cs',
      '*.g.cs',
      '*.generated.cs',
      '**/AssemblyInfo.cs',
      '**/GlobalUsings.cs',
    ],
    typescript: [
      '*.d.ts',
      '*.min.js',
      '*.bundle.js',
      '**/generated/**',
    ],
  },
};

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const user = JSON.parse(raw) as Partial<Config>;
      // Deep-merge scanExcludePatterns: user arrays replace defaults per-key
      const merged: Config = { ...DEFAULT_CONFIG, ...user };
      if (user.scanExcludePatterns || DEFAULT_CONFIG.scanExcludePatterns) {
        merged.scanExcludePatterns = {
          global: user.scanExcludePatterns?.global ?? DEFAULT_CONFIG.scanExcludePatterns?.global ?? [],
          csharp: user.scanExcludePatterns?.csharp ?? DEFAULT_CONFIG.scanExcludePatterns?.csharp ?? [],
          typescript: user.scanExcludePatterns?.typescript ?? DEFAULT_CONFIG.scanExcludePatterns?.typescript ?? [],
        };
      }
      return merged;
    }
  } catch { }
  return { ...DEFAULT_CONFIG };
}

function ensureConfigFile(): void {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

export function findGitRoot(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf8', timeout: 3000
  });
  return (result.status === 0 && result.stdout.trim()) ? result.stdout.trim() : dir;
}

// ── LCOV coverage watcher ──────────────────────────────────────────────────

// Tracks every lcov path we are already polling to prevent duplicate watchers.
const watchedLcovPaths = new Set<string>();
// Per-repo debounce timers so rapid LCOV writes don't flood the scan pipeline.
const lcovDebounceTimers = new Map<string, NodeJS.Timeout>();

// Mirrors CoverageAnalyzer.findLcovFile() so the watcher covers the same search space.
function coverageLcovCandidates(repoRoot: string): string[] {
  return [
    path.join(repoRoot, 'coverage', 'lcov.info'),
    path.join(repoRoot, 'coverage', 'lcov-report', 'lcov.info'),
    path.join(repoRoot, 'lcov.info'),
    path.join(repoRoot, '.coverage', 'lcov.info'),
  ];
}

// Uses fs.watchFile (stat-polling) instead of fs.watch (inotify) because inotify
// silently drops events on WSL DrvFs/NFS mounts, while polling works everywhere.
function startLcovWatcher(repoRoot: string, vizServer: VizServer): void {
  for (const lcovPath of coverageLcovCandidates(repoRoot)) {
    if (watchedLcovPaths.has(lcovPath)) continue;
    watchedLcovPaths.add(lcovPath);

    fs.watchFile(lcovPath, { persistent: false, interval: 5_000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;

      const existing = lcovDebounceTimers.get(repoRoot);
      if (existing) clearTimeout(existing);
      lcovDebounceTimers.set(repoRoot, setTimeout(() => {
        lcovDebounceTimers.delete(repoRoot);
        console.error(`[gate-keeper] Coverage changed for ${path.basename(repoRoot)} — re-analyzing...`);
        vizServer.scanRepo(repoRoot, true).catch(err => {
          console.error(`[gate-keeper] Coverage re-analysis error: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, 2_000));
    });
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noScan = args.includes('--no-scan');
  const qualityLoop = args.includes('--quality-loop');
  const watchMode = args.includes('--watch');
  const queryMode = args.includes('--query') || args.includes('-q');

  // --query mode: start REPL instead of daemon
  if (queryMode) {
    const repoIndex = args.indexOf('--query') + 1 || args.indexOf('-q') + 1;
    const repo = (args[repoIndex] && !args[repoIndex]!.startsWith('-'))
      ? args[repoIndex]!
      : findGitRoot(process.cwd());
    const { startRepl } = await import('./cli/query-repl');
    await startRepl(repo);
    return; // REPL handles its own process.exit
  }

  ensurePidFile();
  ensureConfigFile();

  const config = loadConfig();
  const workDir = process.cwd();
  const repoRoot = findGitRoot(workDir);

  const cache = new SqliteCache();
  const analyzer = new UniversalAnalyzer();
  const vizServer = new VizServer(cache, analyzer, workDir, repoRoot, config);

  await vizServer.start();

  // Start LCOV watchers for all repos already in the cache so that running
  // `npm test --coverage` automatically refreshes dashboard ratings.
  for (const { path: r } of cache.getAllRepositories()) {
    startLcovWatcher(r, vizServer);
  }

  // Quality Loop Orchestrator — always available via dashboard
  // Use --quality-loop to auto-start processing on daemon launch
  const qlConfig = loadQualityConfig();
  if (qlConfig.repos.length === 0) {
    const registered = cache.getAllRepositories(true);
    qlConfig.repos = registered.map(r => r.path);
    if (qlConfig.repos.length === 0) {
      qlConfig.repos = cache.getRepos();
    }
  }
  const orchestrator = new QualityOrchestrator(qlConfig, cache, {
    broadcast: (msg) => vizServer.broadcastMessage(msg),
    getAnalyzedFiles: (repo) => {
      const analyses = cache.getAll(repo);
      return analyses.map(a => ({ path: a.path, rating: a.rating, repoRoot: a.repoRoot ?? repo }));
    },
  });
  if (qualityLoop) {
    orchestrator.start();
  }
  console.error(`[gate-keeper] Quality loop ready (threshold: ${qlConfig.threshold}, workers: ${qlConfig.maxWorkers}, auto-start: ${qualityLoop})`);

  if (!noScan) {
    // Initial workspace scan — runs in the background, non-blocking
    vizServer.scan(false).catch(err => {
      console.error('[gate-keeper] Initial scan failed:', err);
    });
  } else {
    console.error('[gate-keeper] Started with --no-scan, skipping initial scan');
  }

  // Graph watch mode — polls source files for mtime changes and re-analyzes
  if (watchMode) {
    const watcher = new WatchMode();
    const POLL_MS = parseInt(process.env['GK_WATCH_INTERVAL'] ?? '5000', 10);
    watcher.start(repoRoot, (changedFiles) => {
      console.error(`[gate-keeper] Watch: ${changedFiles.length} changed file(s) — re-analyzing`);
      for (const fp of changedFiles) {
        // Same logic as the /analyze IPC endpoint — inline it for watch mode
        (async () => {
          try {
            const analysis = await analyzer.analyze(fp);
            if (!analysis) return;
            analysis.repoRoot = repoRoot;
            cache.save(analysis);
            vizServer.pushAnalysis(analysis);
          } catch (err) {
            console.error(`[gate-keeper] Watch re-analysis error: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
      }
    }, POLL_MS);
    console.error(`[gate-keeper] Watch mode active (polling every ${POLL_MS}ms) for ${repoRoot}`);
    process.on('exit', () => watcher.stop());
  }

  // IPC HTTP server — only binds to localhost
  const ipc = express();
  ipc.use(express.json());
  ipc.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  ipc.get('/health', (_req, res) => {
    res.json({ ok: true, pid: process.pid });
  });

  // Register a new repository from session_create hook
  ipc.post('/repo-register', async (req, res) => {
    const { action, repo } = req.body as {
      action: string;
      repo: { path?: string; name?: string; sessionId?: string; sessionType?: string; createdAt?: number };
    };

    if (action !== 'register_repo' || !repo?.path) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    try {
      const repoId = crypto.createHash('md5').update(repo.path).digest('hex');
      const isNew = !cache.getRepository(repoId);
      const metadata: RepoMetadata = {
        id: repoId,
        path: repo.path,
        name: repo.name || path.basename(repo.path) || repo.path,
        sessionId: repo.sessionId,
        sessionType: (repo.sessionType as RepoMetadata['sessionType']) || 'unknown',
        createdAt: repo.createdAt || Date.now(),
        isActive: true
      };

      cache.saveRepository(metadata);
      vizServer.broadcastRepoCreated(metadata);
      startLcovWatcher(metadata.path, vizServer);

      console.error(`[gate-keeper] Repository ${isNew ? 'registered' : 'updated'}: ${metadata.name} (${metadata.id})`);

      res.json({ ok: true, repoId, repo: metadata, isNew });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[gate-keeper] Repo registration error: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // Synchronously analyzes the file and returns the result so the hook-receiver
  // can gate on the rating in the same PostToolUse event.
  ipc.post('/analyze', async (req, res) => {
    const { filePath, repoRoot: reqRepo } = req.body as DaemonRequest;

    if (!filePath || !fs.existsSync(filePath) || !analyzer.isSupportedFile(filePath)) {
      res.json({ analysis: null, minRating: loadConfig().minRating });
      return;
    }

    try {
      const analysis = await analyzer.analyze(filePath);
      if (!analysis) {
        res.json({ analysis: null, minRating: loadConfig().minRating });
        return;
      }
      analysis.repoRoot = reqRepo || repoRoot;

      // Auto-detect and store layer assignment
      const relPath = path.relative(analysis.repoRoot, filePath);
      const archConfig = readArchConfig(analysis.repoRoot);
      const detectedLayer = analysis.violations.length > 0 ? 'unknown' : 'application';
      mergeFileLayer(analysis.repoRoot, relPath, detectedLayer);
      analysis.layer = getEffectiveLayer(archConfig, relPath);

      cache.save(analysis);
      vizServer.pushAnalysis(analysis);

      const liveConfig = loadConfig();
      console.error(
        `[gate-keeper] ${path.basename(filePath)} — rating: ${analysis.rating}/10, violations: ${analysis.violations.length}`
      );
      res.json({ analysis, minRating: liveConfig.minRating });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[gate-keeper] Analysis error for ${filePath}: ${msg}`);
      res.json({ analysis: null, minRating: loadConfig().minRating });
    }
  });

  // Get list of repositories
  ipc.get('/repos', (_req, res) => {
    const repos = cache.getAllRepositories(true);
    res.json({ repos });
  });

  // Manually trigger a full re-analysis of all files in a repo so that coverage
  // data changes (e.g. after running `npm test --coverage`) are reflected
  // immediately without waiting for the next file-write event.
  ipc.post('/reanalyze-coverage', (req, res) => {
    const { repoRoot: reqRepo } = req.body as { repoRoot?: string };
    const target = reqRepo || repoRoot;
    res.json({ ok: true, message: `Re-analysis started for ${target}` });
    vizServer.scanRepo(target, true).catch(err => {
      console.error(`[gate-keeper] /reanalyze-coverage error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  ipc.listen(IPC_PORT, '127.0.0.1', () => {
    console.error(`[gate-keeper] IPC ready on 127.0.0.1:${IPC_PORT}`);
    console.error(`[gate-keeper] Min rating: ${config.minRating} (edit ${CONFIG_FILE} to change)`);
  });

  // Quality Loop IPC endpoints
  ipc.get('/api/quality/queue', (_req, res) => {
    const items = orchestrator.getQueueItems();
    res.json({ items });
  });

  ipc.get('/api/quality/status', (_req, res) => {
    const stats = orchestrator.stats;
    res.json({ stats, running: orchestrator.isRunning, paused: orchestrator.isPaused });
  });

  ipc.post('/api/quality/start', (_req, res) => {
    if (!orchestrator.isRunning) orchestrator.start();
    res.json({ ok: true });
  });

  ipc.post('/api/quality/stop', (_req, res) => {
    orchestrator.stop();
    res.json({ ok: true });
  });

  ipc.post('/api/quality/pause', (_req, res) => {
    orchestrator.pause();
    res.json({ ok: true });
  });

  ipc.post('/api/quality/resume', (_req, res) => {
    orchestrator.resume();
    res.json({ ok: true });
  });

  ipc.post('/api/quality/enqueue', async (_req, res) => {
    const count = await orchestrator.enqueueRepos();
    res.json({ ok: true, enqueued: count });
  });

  ipc.post('/api/quality/reset', (_req, res) => {
    const count = orchestrator.resetFailed();
    res.json({ ok: true, reset: count });
  });

  ipc.get('/api/quality/trends', (_req, res) => {
    res.json(orchestrator.getTrends());
  });

  ipc.get('/api/quality/attempts/:id', (req, res) => {
    const id = parseInt(req.params['id']!, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }
    res.json(orchestrator.getAttempts(id));
  });

  ipc.get('/api/quality/config', (_req, res) => {
    res.json(orchestrator.getConfig());
  });

  ipc.post('/api/quality/config', (req, res) => {
    const { threshold, maxWorkers } = req.body as { threshold?: number; maxWorkers?: number };
    if (threshold != null) orchestrator.updateConfig({ threshold });
    if (maxWorkers != null) orchestrator.updateConfig({ maxWorkers });
    res.json({ ok: true, config: orchestrator.getConfig() });
  });

  // ── Manual execution endpoints ──────────────────────────────────────────

  ipc.post('/api/quality/execute/:id', async (req, res) => {
    const id = parseInt(req.params['id']!, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }
    const result = await orchestrator.executeItem(id);
    res.json(result);
  });

  ipc.get('/api/quality/output/:workerId', (req, res) => {
    const wid = req.params['workerId']!;
    const output = orchestrator.getExecutionOutput(wid);
    if (!output) { res.status(404).json({ error: 'execution not found' }); return; }
    res.json(output);
  });

  ipc.post('/api/quality/cancel/:workerId', (req, res) => {
    const wid = req.params['workerId']!;
    const ok = orchestrator.cancelExecution(wid);
    res.json({ ok });
  });

  ipc.post('/api/quality/queue/:id/delete', (req, res) => {
    const id = parseInt(req.params['id']!, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }
    const ok = orchestrator.deleteQueueItem(id);
    res.json({ ok });
  });

  ipc.get('/api/quality/cmd/:id', (req, res) => {
    const id = parseInt(req.params['id']!, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }
    const cmd = orchestrator.getCmdForItem(id);
    if (!cmd) { res.status(404).json({ error: 'item not found' }); return; }
    res.json(cmd);
  });

  // Only register signal handlers once per process
  if (process._gateKeeperSignalsRegistered !== true) {
    process.on('SIGTERM', () => shutdown(cache));
    process.on('SIGINT', () => shutdown(cache));
    process._gateKeeperSignalsRegistered = true;
  }

  console.error(`[gate-keeper] Daemon started (PID ${process.pid})`);
}

function ensurePidFile(): void {
  const dir = path.dirname(PID_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function shutdown(cache: SqliteCache): void {
  try { fs.unlinkSync(PID_FILE); } catch { }
  for (const p of watchedLcovPaths) fs.unwatchFile(p);
  for (const t of lcovDebounceTimers.values()) clearTimeout(t);
  cache.close();
  process.exit(0);
}

// Only run main() if this is the entry point (not in tests)
if (process.env.NODE_ENV !== 'test') {
  main().catch(err => {
    console.error('[gate-keeper] Fatal:', err);
    process.exit(1);
  });
}
