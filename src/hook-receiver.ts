/**
 * gate-keeper hook-receiver
 *
 * Called by Claude Code's PostToolUse hook on every Write/Edit operation.
 * Waits for the daemon to finish analysis, then exits with code 2 (blocking
 * feedback) if the file rating falls below the configured minimum — forcing
 * Claude Code to surface the violations before the agent can continue.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { FileAnalysis, HookPayload } from './types';

interface AnalyzeResponse {
  analysis: FileAnalysis | null;
  minRating: number;
}

const IPC_PORT = 5379;
const PID_FILE = path.join(process.env.HOME ?? '/tmp', '.gate-keeper', 'daemon.pid');
const DAEMON_SCRIPT = path.join(__dirname, 'daemon.js');

const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);

async function main(): Promise<void> {
  const payload = await readStdin();
  if (!payload) return;

  const filePath = payload.tool_input?.file_path ?? payload.tool_input?.path;
  if (!filePath) return;

  const ext = path.extname(filePath);
  if (!WATCHED_EXTENSIONS.has(ext)) return;

  await ensureDaemonRunning();

  const result = await sendToDaemon(filePath);
  if (!result?.analysis) return;

  const { analysis, minRating } = result;
  if (analysis.rating < minRating) {
    const lines: string[] = [
      `[Gate Keeper] ${path.basename(filePath)} rated ${analysis.rating}/10 (minimum ${minRating}/10) — fix violations before proceeding:`,
    ];
    for (const v of analysis.violations) {
      const loc = v.line != null ? ` (line ${v.line})` : '';
      const fix = v.fix ? ` — ${v.fix}` : '';
      lines.push(`  [${v.severity}] ${v.message}${loc}${fix}`);
    }
    lines.push(`\nRaise the rating to at least ${minRating}/10 before moving on.`);
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(2);
  }
}

function readStdin(): Promise<HookPayload | null> {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (data += chunk));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data) as HookPayload);
      } catch {
        resolve(null);
      }
    });
    // Don't block if stdin never closes
    setTimeout(() => resolve(null), 2000);
  });
}

async function ensureDaemonRunning(): Promise<void> {
  if (isDaemonAlive()) return;

  if (!fs.existsSync(DAEMON_SCRIPT)) return;

  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env }
  });
  child.unref();

  // Give the daemon a moment to bind its port
  await sleep(300);
}

function isDaemonAlive(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0); // throws if process doesn't exist
    return true;
  } catch {
    return false;
  }
}

function findGitRoot(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf8', timeout: 3000
  });
  return (result.status === 0 && result.stdout.trim()) ? result.stdout.trim() : dir;
}

function sendToDaemon(filePath: string): Promise<AnalyzeResponse | null> {
  const repoRoot = findGitRoot(path.dirname(filePath));
  return new Promise(resolve => {
    const body = JSON.stringify({ filePath, repoRoot });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: IPC_PORT,
        path: '/analyze',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data) as AnalyzeResponse); }
          catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    // Analysis can take a few seconds for large files — generous timeout so we
    // don't silently drop the gate on slow machines.
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}


main().catch(() => {}).finally(() => process.exit(0));
