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
import { DaemonRequest } from './types';

const IPC_PORT = 5379;
const PID_FILE = path.join(process.env.HOME ?? '/tmp', '.gate-keeper', 'daemon.pid');

async function main(): Promise<void> {
  ensurePidFile();

  const cache = new SqliteCache();
  const analyzer = new UniversalAnalyzer();
  const vizServer = new VizServer(cache);

  await vizServer.start();

  // IPC HTTP server — only binds to localhost
  const ipc = express();
  ipc.use(express.json());

  ipc.get('/health', (_req, res) => {
    res.json({ ok: true, pid: process.pid });
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

      const rating = analysis.rating;
      const violations = analysis.violations.length;
      console.error(
        `[gate-keeper] ${path.basename(filePath)} — rating: ${rating}/10, violations: ${violations}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[gate-keeper] Analysis error for ${filePath}: ${msg}`);
    }
  });

  ipc.listen(IPC_PORT, '127.0.0.1', () => {
    console.error(`[gate-keeper] IPC ready on 127.0.0.1:${IPC_PORT}`);
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
