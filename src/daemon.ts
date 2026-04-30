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

const IPC_PORT = 5379;
const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
const PID_FILE = path.join(GK_DIR, 'daemon.pid');
const CONFIG_FILE = path.join(GK_DIR, 'config.json');

const DEFAULT_CONFIG: Config = { minRating: 6.5 };

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function ensureConfigFile(): void {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

function findGitRoot(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf8', timeout: 3000
  });
  return (result.status === 0 && result.stdout.trim()) ? result.stdout.trim() : dir;
}

async function main(): Promise<void> {
  ensurePidFile();
  ensureConfigFile();

  const config = loadConfig();
  const workDir = process.cwd();
  const repoRoot = findGitRoot(workDir);

  const cache = new SqliteCache();
  const analyzer = new UniversalAnalyzer();
  const vizServer = new VizServer(cache, analyzer, workDir, repoRoot);

  await vizServer.start();

  // Initial workspace scan — runs in the background, non-blocking
  vizServer.scan(false).catch(err => {
    console.error('[gate-keeper] Initial scan failed:', err);
  });

  // IPC HTTP server — only binds to localhost
  const ipc = express();
  ipc.use(express.json());

  ipc.get('/health', (_req, res) => {
    res.json({ ok: true, pid: process.pid });
  });

  // Register a new repository from session_create hook
  ipc.post('/repo-register', async (req, res) => {
    const { action, repo } = req.body as { action: string; repo: any };

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
        sessionType: repo.sessionType || 'unknown',
        createdAt: repo.createdAt || Date.now(),
        isActive: true
      };

      cache.saveRepository(metadata);
      vizServer.broadcastRepoCreated(metadata);

      console.error(`[gate-keeper] Repository ${isNew ? 'registered' : 'updated'}: ${metadata.name} (${metadata.id})`);

      if (isNew) {
        vizServer.scanRepo(metadata.path).catch(err => {
          console.error(`[gate-keeper] Initial scan failed for ${metadata.name}: ${err instanceof Error ? err.message : err}`);
        });
      }

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

  process.on('SIGTERM', () => shutdown(cache));
  process.on('SIGINT', () => shutdown(cache));

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
  } catch {}
  cache.close();
  process.exit(0);
}

main().catch(err => {
  console.error('[gate-keeper] Fatal:', err);
  process.exit(1);
});
