/**
 * gate-keeper hook-receiver
 *
 * Called by Claude Code's PostToolUse hook on every Write/Edit operation,
 * and also on session_create events to register new repos.
 * Waits for the daemon to finish analysis, then exits with code 2 (blocking
 * feedback) if the file rating falls below the configured minimum — forcing
 * Claude Code to surface the violations before the agent can continue.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { Config, FileAnalysis, HookPayload, SessionCreatePayload } from './types';

interface AnalyzeResponse {
  analysis: FileAnalysis | null;
  minRating: number;
}

const IPC_PORT = 5379;
const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
const PID_FILE = path.join(GK_DIR, 'daemon.pid');
const SESSIONS_DIR = path.join(GK_DIR, 'sessions');
const DAEMON_SCRIPT = path.join(__dirname, 'daemon.js');

export const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);

const CONFIG_FILE = path.join(GK_DIR, 'config.json');

/** Convert a simple glob pattern to a RegExp */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*');
  
  // Handle **/ at the start - it should match zero or more directories
  const processed = escaped.replace(/^__GLOBSTAR__\//, '(?:.*/)?');
  // Handle **/ in the middle - replace with .*
  const final = processed.replace(/__GLOBSTAR__/g, '.*');
  
  return new RegExp(final, 'i');
}

function loadScanExcludePatterns(): Config['scanExcludePatterns'] | undefined {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return raw.scanExcludePatterns;
    }
  } catch { }
  return undefined;
}

export function isFileExcludedByScanConfig(filePath: string, ext: string): boolean {
  const patterns = loadScanExcludePatterns();
  if (!patterns) return false;
  const fileName = filePath.split('/').pop() ?? filePath;
  const langKey = ext === '.cs' ? 'csharp' : ['.ts', '.tsx', '.jsx', '.js'].includes(ext) ? 'typescript' : null;

  const allPatterns = [
    ...(patterns.global ?? []),
    ...(langKey ? (patterns[langKey] ?? []) : []),
  ];
  return allPatterns.some(p => {
    const re = globToRegex(p);
    return re.test(filePath) || re.test(fileName);
  });
}

async function main(): Promise<void> {
  const payload = await readStdin();
  if (!payload) return;

  // Handle session_create events (VS Code / GitHub Copilot task)
  if (payload.hook_event_name === 'session_create') {
    const sessionPayload = payload as unknown as SessionCreatePayload;
    await ensureDaemonRunning();
    await registerRepository(sessionPayload);
    return;
  }

  // Handle Claude Code SessionStart — fires exactly once when a new session begins
  if (payload.hook_event_name === 'SessionStart') {
    const sessionId = payload.session_id;
    const cwd = payload.cwd;
    if (sessionId && cwd) {
      await ensureDaemonRunning();
      const gitRoot = findGitRoot(cwd);
      await registerRepository({
        session_id: sessionId,
        hook_event_name: 'session_create',
        tool_name: 'claude',
        session_info: {
          workspace_path: cwd,
          git_root: gitRoot,
          session_type: 'claude'
        }
      });
    }
    return;
  }

  // Handle Claude Code session start — fires on every user prompt, deduplicated by session_id
  if (payload.hook_event_name === 'UserPromptSubmit') {
    const sessionId = payload.session_id;
    const cwd = payload.cwd;
    if (sessionId && cwd && !isSessionRegistered(sessionId)) {
      markSessionRegistered(sessionId);
      await ensureDaemonRunning();
      const gitRoot = findGitRoot(cwd);
      await registerRepository({
        session_id: sessionId,
        hook_event_name: 'session_create',
        tool_name: 'claude',
        session_info: {
          workspace_path: cwd,
          git_root: gitRoot,
          session_type: 'claude'
        }
      });
    }
    return;
  }

  // Handle file analysis on Write/Edit
  const filePath = payload.tool_input?.file_path ?? payload.tool_input?.path;
  if (!filePath) return;

  const ext = path.extname(filePath);
  if (!WATCHED_EXTENSIONS.has(ext)) return;

  // Check scan exclude patterns from config — skip excluded files early
  if (isFileExcludedByScanConfig(filePath, ext)) return;

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

function isSessionRegistered(sessionId: string): boolean {
  try {
    return fs.existsSync(path.join(SESSIONS_DIR, sessionId));
  } catch {
    return false;
  }
}

function markSessionRegistered(sessionId: string): void {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSIONS_DIR, sessionId), String(Date.now()));
  } catch { }
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

async function registerRepository(sessionPayload: SessionCreatePayload): Promise<void> {
  const workspacePath = sessionPayload.session_info.workspace_path;
  const gitRoot = sessionPayload.session_info.git_root || findGitRoot(workspacePath);
  const sessionType = sessionPayload.session_info.session_type || 'unknown';

  const body = JSON.stringify({
    action: 'register_repo',
    repo: {
      path: gitRoot,
      name: path.basename(gitRoot) || gitRoot,
      sessionId: sessionPayload.session_id,
      sessionType,
      createdAt: Date.now()
    }
  });

  return new Promise(resolve => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: IPC_PORT,
        path: '/repo-register',
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
        res.on('end', () => resolve());
      }
    );
    req.on('error', () => resolve());
    req.setTimeout(5000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}


main().catch(() => { }).finally(() => process.exit(0));
