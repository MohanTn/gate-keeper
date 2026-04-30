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
import { UniversalAnalyzer } from './analyzer/universal-analyzer';
import { SqliteCache } from './cache/sqlite-cache';
import { VizServer } from './viz/viz-server';
import { Config, DaemonRequest } from './types';

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

async function main(): Promise<void> {
  ensurePidFile();
  ensureConfigFile();

  const config = loadConfig();
  const pendingFeedback: string[] = [];

  const cache = new SqliteCache();
  const analyzer = new UniversalAnalyzer();
  const vizServer = new VizServer(cache, analyzer, process.cwd());

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

  // Returns and clears any low-rating feedback queued since the last call.
  // The hook-receiver calls this after each PostToolUse event to surface
  // warnings to Claude Code without blocking the < 100ms exit window.
  ipc.get('/feedback', (_req, res) => {
    const messages = pendingFeedback.splice(0);
    res.json({ messages });
  });

  ipc.post('/analyze', async (req, res) => {
    const { filePath } = req.body as DaemonRequest;
    res.json({ queued: true });

    if (!filePath || !fs.existsSync(filePath)) return;
    if (!analyzer.isSupportedFile(filePath)) return;

    try {
      const analysis = await analyzer.analyze(filePath);
      if (!analysis) return;
      cache.save(analysis);
      vizServer.pushAnalysis(analysis);

      const { rating, violations } = analysis;
      console.error(
        `[gate-keeper] ${path.basename(filePath)} — rating: ${rating}/10, violations: ${violations.length}`
      );

      // Re-read config on each analysis so hot-editing config.json takes effect
      const liveConfig = loadConfig();
      if (rating < liveConfig.minRating) {
        const lines: string[] = [
          `[Gate Keeper] Low quality: ${path.basename(filePath)} rated ${rating}/10 (minimum ${liveConfig.minRating}/10)`,
          'Violations to fix:'
        ];
        for (const v of violations) {
          const loc = v.line != null ? ` (line ${v.line})` : '';
          const fix = v.fix ? ` — ${v.fix}` : '';
          lines.push(`  [${v.severity}] ${v.message}${loc}${fix}`);
        }
        lines.push(`Raise the rating to at least ${liveConfig.minRating}/10 before moving on.`);
        pendingFeedback.push(lines.join('\n'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[gate-keeper] Analysis error for ${filePath}: ${msg}`);
    }
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
