/**
 * gate-keeper hook-receiver
 *
 * Called by Claude Code's PostToolUse hook on every Write/Edit operation.
 * Must exit in < 100ms — all heavy work is delegated to the daemon.
 *
 * Reads JSON from stdin, extracts the file path, wakes the daemon (starting
 * it in the background if needed), then exits immediately.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { HookPayload } from './types';

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
  await sendToDaemon(filePath);
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

function sendToDaemon(filePath: string): Promise<void> {
  return new Promise(resolve => {
    const body = JSON.stringify({ filePath });
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
        res.resume();
        res.on('end', resolve);
      }
    );
    req.on('error', () => resolve()); // daemon may not be ready yet — that's fine
    req.setTimeout(1500, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(() => {}).finally(() => process.exit(0));
