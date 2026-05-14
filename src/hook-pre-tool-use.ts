/**
 * gate-keeper pre-tool-use hook
 *
 * Called by Claude Code's PreToolUse hook on every Write/Edit operation.
 * Calls the daemon's check_pre_edit_safety endpoint and blocks (exit code 2)
 * if the edit would impact 3+ fragile dependents or has a "block" verdict.
 *
 * This prevents the AI from modifying high-risk files without understanding
 * the blast radius. It's a safety gate, not a quality gate — for quality,
 * see hook-receiver.ts (PostToolUse).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const DAEMON_PORT = 5378;
const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
const PID_FILE = path.join(GK_DIR, 'daemon.pid');
const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);

// ── Daemon liveness check ─────────────────────────────────

function isDaemonAlive(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Daemon API call ───────────────────────────────────────

function fetchDaemonApi(urlPath: string, body?: string): Promise<unknown> {
  return new Promise((resolve) => {
    const isPost = !!body;
    const req = http.request(
      `http://127.0.0.1:${DAEMON_PORT}${urlPath}`,
      {
        method: isPost ? 'POST' : 'GET',
        timeout: 5000,
        headers: isPost ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (body) req.write(body);
    req.end();
  });
}

// ── Git repo root ─────────────────────────────────────────

function findGitRoot(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf8', timeout: 3000,
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : dir;
}

// ── Main ──────────────────────────────────────────────────

export async function main(): Promise<void> {
  // Read the JSON payload from stdin (Claude Code passes the hook event as JSON)
  let payload = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) payload += chunk;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(payload);
  } catch {
    return; // Not valid JSON — silently pass through
  }

  // Extract the file path from the tool input
  const toolInput = event['tool_input'] as Record<string, unknown> | undefined;
  if (!toolInput) return;
  const filePath = (toolInput['file_path'] ?? toolInput['path'] ?? '') as string;
  if (!filePath) return;

  const ext = path.extname(filePath);
  if (!WATCHED_EXTENSIONS.has(ext)) return;
  if (!isDaemonAlive()) return;

  // Resolve the repo root
  const cwd = (event['cwd'] ?? process.cwd()) as string;
  const repo = findGitRoot(cwd);
  const encodedRepo = encodeURIComponent(repo);

  // Call the dedicated impact-set API endpoint
  const encodedFile = encodeURIComponent(filePath);
  const impactResult = await fetchDaemonApi(
    `/api/impact-set?file=${encodedFile}&repo=${encodedRepo}&depth=1`,
  ) as {
    verdict?: string;
    fragileCount?: number;
    directDependents?: number;
    riskScore?: number;
    fileRating?: number | null;
    reason?: string;
  } | null;

  if (!impactResult) return;

  // Blocking conditions from the verdict
  if (impactResult.verdict === 'block' || (impactResult.fragileCount ?? 0) >= 3) {
    const lines = [
      `[Gate Keeper] ⚠️ Pre-edit safety check: ${path.basename(filePath)}`,
      `  ${impactResult.reason ?? 'High risk of cascading failures'}`,
      `  Rating: ${impactResult.fileRating ?? '?'}/10 · Direct dependents: ${impactResult.directDependents ?? 0}`,
      `  Fix fragile dependents first, then retry the edit.`,
      `  Use get_impact_set(file_path="${filePath}", depth=1) to see the full impact set.`,
    ];
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(2); // Exit code 2 signals Claude Code to surface the warning and stop
  }
}

if (require.main === module) {
  main().catch(() => process.exit(0)); // Errors are non-blocking — pass through
}
