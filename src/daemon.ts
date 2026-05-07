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
import { mergeFileLayer, getEffectiveLayer, readArchConfig, DEFAULT_LAYERS } from './arch/arch-config-manager';

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noScan = args.includes('--no-scan');

  ensurePidFile();
  ensureConfigFile();

  const config = loadConfig();
  const workDir = process.cwd();
  const repoRoot = findGitRoot(workDir);

  const cache = new SqliteCache();
  const analyzer = new UniversalAnalyzer();
  const vizServer = new VizServer(cache, analyzer, workDir, repoRoot, config);

  await vizServer.start();

  if (!noScan) {
    // Initial workspace scan — runs in the background, non-blocking
    vizServer.scan(false).catch(err => {
      console.error('[gate-keeper] Initial scan failed:', err);
    });
  } else {
    console.error('[gate-keeper] Started with --no-scan, skipping initial scan');
  }

  // IPC HTTP server — only binds to localhost
  const ipc = express();
  ipc.use(express.json());

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

  ipc.listen(IPC_PORT, '127.0.0.1', () => {
    console.error(`[gate-keeper] IPC ready on 127.0.0.1:${IPC_PORT}`);
    console.error(`[gate-keeper] Min rating: ${config.minRating} (edit ${CONFIG_FILE} to change)`);
  });

  // Only register signal handlers once per process
  if ((process as any)._gateKeeperSignalsRegistered !== true) {
    process.on('SIGTERM', () => shutdown(cache));
    process.on('SIGINT', () => shutdown(cache));
    (process as any)._gateKeeperSignalsRegistered = true;
  }

  console.error(`[gate-keeper] Daemon started (PID ${process.pid})`);
}

function ensurePidFile(): void {
  const dir = path.dirname(PID_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function shutdown(cache: SqliteCache): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch { }
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
