import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';
import { FileAnalysis, WorkerResult } from '../types';

const DAEMON_IPC = 'http://127.0.0.1:5379';
const VIZ_API = 'http://127.0.0.1:5378';
const POLL_INTERVAL = 5_000;   // 5 s — snappy enough without hammering the daemon
const MAX_WAIT = 300_000;      // 5 min hard ceiling

/** Files written to /tmp for one fix attempt */
interface TerminalHandle {
  scriptFile: string;
  promptFile: string;
  statusFile: string;
  logFile: string;
}

/** Written by the bash script's EXIT trap so the worker knows Claude stopped */
interface ClaudeStatus {
  exitCode: number;
  timestamp: number; // unix seconds
}

export class FixWorker {
  private filePath: string;
  private repo: string;
  private threshold: number;

  constructor(opts: { filePath: string; repo: string; threshold: number }) {
    this.filePath = opts.filePath;
    this.repo = opts.repo;
    this.threshold = opts.threshold;
  }

  async fix(): Promise<WorkerResult> {
    const startTime = Date.now();

    const analysis = await this.fetchAnalysis();
    if (!analysis) {
      return {
        success: false, newRating: 0, ratingBefore: 0,
        violationsRemaining: 0, violationsFixed: 0,
        durationMs: Date.now() - startTime, attemptNumber: 1,
        fixSummary: '', error: 'Could not fetch analysis',
        shouldRetry: false,
      };
    }

    const ratingBefore = analysis.rating;
    if (ratingBefore >= this.threshold) {
      return {
        success: true, newRating: ratingBefore, ratingBefore,
        violationsRemaining: 0, violationsFixed: 0,
        durationMs: 0, attemptNumber: 0,
        fixSummary: 'Already passes threshold',
        shouldRetry: false,
      };
    }

    const numberedViolations = analysis.violations.map((v, i) =>
      `${i + 1}. [${v.severity.toUpperCase()}]${v.line ? ` (line ${v.line})` : ''}: ${v.message}${v.fix ? `\n   Fix: ${v.fix}` : ''}`
    ).join('\n');

    const prompt = `fix all violation going on in this file @${this.filePath}
File: ${this.filePath}
Rating: ${analysis.rating}/10
Violations: ${analysis.violations.length}

${numberedViolations}`;

    const claudePath = this.resolveClaudePath();
    const handle = this.createHandle();

    const opened = this.openTerminal(prompt, claudePath, handle);
    if (!opened) {
      this.cleanupHandle(handle, 0);
      return {
        success: false, newRating: ratingBefore, ratingBefore,
        violationsRemaining: analysis.violations.length, violationsFixed: 0,
        durationMs: Date.now() - startTime, attemptNumber: 1,
        fixSummary: '', error: 'Could not open terminal',
        shouldRetry: true,
      };
    }

    const result = await this.waitForCompletion(handle, analysis, ratingBefore, startTime);
    this.cleanupHandle(handle, 5_000);
    return result;
  }

  // ── Terminal lifecycle ─────────────────────────────────────────────────────

  private createHandle(): TerminalHandle {
    const id = `gk-fix-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tmp = os.tmpdir();
    return {
      scriptFile: path.join(tmp, `${id}.sh`),
      promptFile: path.join(tmp, `${id}.prompt`),
      statusFile: path.join(tmp, `${id}.status`),
      logFile:    path.join(tmp, `${id}.log`),
    };
  }

  private cleanupHandle(handle: TerminalHandle, delayMs: number): void {
    const remove = () => {
      for (const f of Object.values(handle)) {
        try { fs.unlinkSync(f); } catch { /* already gone */ }
      }
    };
    if (delayMs <= 0) remove();
    else setTimeout(remove, delayMs);
  }

  /**
   * Writes the bash script and opens a terminal to run it.
   *
   * The script writes a JSON status file via a `trap EXIT` handler so the
   * worker hears about Claude finishing regardless of how the terminal closes
   * (clean exit, crash, user closes the window, SIGTERM from OS, etc.).
   *
   * The prompt is written to a separate file so no shell-escaping is needed
   * for the arbitrary text inside it.
   */
  private openTerminal(prompt: string, claudePath: string, handle: TerminalHandle): boolean {
    try {
      fs.writeFileSync(handle.promptFile, prompt, 'utf8');

      // Single-quoted variable references inside the heredoc are intentional:
      // they expand at bash runtime (inside the terminal), not at Node write time.
      fs.writeFileSync(handle.scriptFile, `#!/usr/bin/env bash
source ~/.bashrc 2>/dev/null || true
set -uo pipefail

PROMPT_FILE='${handle.promptFile}'
STATUS_FILE='${handle.statusFile}'
LOG_FILE='${handle.logFile}'
CLAUDE='${claudePath}'
REPO='${this.repo}'

EXIT_CODE=0

# This trap fires for ANY exit — clean, crashed, SIGTERM, window close, etc.
on_exit() {
  local last=$?
  # If EXIT_CODE is still 0 but the shell caught a signal, record the signal exit
  [ "$last" -ne 0 ] && [ "$EXIT_CODE" -eq 0 ] && EXIT_CODE=$last
  printf '{"exitCode":%d,"timestamp":%d}' "$EXIT_CODE" "$(date +%s)" > "$STATUS_FILE" 2>/dev/null || true
}
trap on_exit EXIT

cd "$REPO"

"$CLAUDE" --dangerously-skip-permissions "$(cat "$PROMPT_FILE")" 2>&1 | tee "$LOG_FILE" || EXIT_CODE=$?

echo ""
echo "────────────────────────────────────────────"
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "  Claude fix finished — press Enter to close"
else
  echo "  Claude exited with code $EXIT_CODE — press Enter to close"
fi
echo "────────────────────────────────────────────"
read -r || true`, 'utf8');

      fs.chmodSync(handle.scriptFile, 0o755);
    } catch {
      return false;
    }

    const opened = this.isWSL()
      ? this.tryOpenWSL(handle.scriptFile)
      : this.tryOpenLinux(handle.scriptFile);

    return opened;
  }

  // ── Completion polling ─────────────────────────────────────────────────────

  /**
   * Polls until one of four terminal conditions is met:
   *
   * 1. Status file appears with exitCode 0  → Claude ran to completion
   * 2. Status file appears with exitCode ≠ 0 → Claude crashed / window closed → retry
   * 3. Rating crosses threshold while Claude is still running → early success
   * 4. MAX_WAIT elapsed with no status file → Claude hung / too slow → retry
   */
  private async waitForCompletion(
    handle: TerminalHandle,
    originalAnalysis: FileAnalysis,
    ratingBefore: number,
    startTime: number,
  ): Promise<WorkerResult> {
    let elapsed = 0;
    let lastRating = ratingBefore;

    while (elapsed < MAX_WAIT) {
      await this.sleep(POLL_INTERVAL);
      elapsed += POLL_INTERVAL;

      const status = this.readStatus(handle.statusFile);
      const current = await this.reanalyze();
      const currentRating = current?.rating ?? lastRating;
      lastRating = currentRating;

      // ── Case 1 & 2: Claude exited (status file written by trap) ────────────
      if (status !== null) {
        const finalRating = currentRating;
        const finalViolations = current?.violations.length ?? originalAnalysis.violations.length;
        const violationsFixed = Math.max(0, originalAnalysis.violations.length - finalViolations);

        if (status.exitCode !== 0) {
          // Abnormal exit (crash, window closed, SIGTERM) — worth retrying
          return {
            success: false,
            newRating: finalRating,
            ratingBefore,
            violationsRemaining: finalViolations,
            violationsFixed,
            durationMs: Date.now() - startTime,
            attemptNumber: 1,
            fixSummary: `Claude exited abnormally (code ${status.exitCode})`,
            error: `Terminal closed or Claude crashed (exit ${status.exitCode})`,
            shouldRetry: true,
          };
        }

        // Clean exit — Claude ran to completion
        const success = finalRating >= this.threshold;
        return {
          success,
          newRating: finalRating,
          ratingBefore,
          violationsRemaining: finalViolations,
          violationsFixed,
          durationMs: Date.now() - startTime,
          attemptNumber: 1,
          fixSummary: success
            ? `Rating improved from ${ratingBefore} to ${finalRating}`
            : `Claude finished but rating ${finalRating} is still below threshold ${this.threshold}`,
          error: success ? undefined : 'Below threshold after Claude finished',
          // Claude cleanly finished but couldn't reach threshold — retrying
          // the same file automatically is unlikely to help without human review
          shouldRetry: false,
          workerOutput: this.readLog(handle.logFile),
        };
      }

      // ── Case 3: threshold met while Claude is still running ─────────────────
      if (currentRating >= this.threshold) {
        const finalViolations = current?.violations.length ?? 0;
        return {
          success: true,
          newRating: currentRating,
          ratingBefore,
          violationsRemaining: finalViolations,
          violationsFixed: Math.max(0, originalAnalysis.violations.length - finalViolations),
          durationMs: Date.now() - startTime,
          attemptNumber: 1,
          fixSummary: `Threshold met mid-session: rating ${ratingBefore} → ${currentRating}`,
          shouldRetry: false,
        };
      }
    }

    // ── Case 4: timeout — Claude never signaled completion ───────────────────
    const final = await this.reanalyze();
    const finalRating = final?.rating ?? lastRating;
    return {
      success: finalRating >= this.threshold,
      newRating: finalRating,
      ratingBefore,
      violationsRemaining: final?.violations.length ?? originalAnalysis.violations.length,
      violationsFixed: Math.max(0, originalAnalysis.violations.length - (final?.violations.length ?? 0)),
      durationMs: Date.now() - startTime,
      attemptNumber: 1,
      fixSummary: `Timed out after ${MAX_WAIT / 1000}s. Final rating: ${finalRating}`,
      error: finalRating >= this.threshold ? undefined : 'Timed out without reaching threshold',
      shouldRetry: finalRating < this.threshold,
    };
  }

  private readStatus(statusFile: string): ClaudeStatus | null {
    try {
      if (!fs.existsSync(statusFile)) return null;
      return JSON.parse(fs.readFileSync(statusFile, 'utf8')) as ClaudeStatus;
    } catch {
      return null;
    }
  }

  private readLog(logFile: string): string | undefined {
    try {
      return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : undefined;
    } catch {
      return undefined;
    }
  }

  // ── Terminal openers ───────────────────────────────────────────────────────

  private tryOpenWSL(scriptPath: string): boolean {
    // Strategy 1: Windows Terminal (wt.exe) — best UX on Win11 / Win10
    try {
      execSync(`command -v wt.exe 2>/dev/null`, { timeout: 1000 });
      spawn('wt.exe', ['-d', '.', 'wsl.exe', 'bash', scriptPath], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch { /* wt.exe not available */ }

    // Strategy 2: cmd.exe /c start — works on every Windows
    try {
      spawn('cmd.exe', [
        '/c', 'start', 'Claude Fix', 'cmd', '/c',
        `wsl.exe bash "${scriptPath}" & pause`,
      ], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch { /* cmd.exe not available */ }

    // Strategy 3: powershell Start-Process (fallback)
    try {
      spawn('powershell.exe', [
        '-NoProfile', '-Command',
        `Start-Process cmd -WindowStyle Normal -ArgumentList '/c wsl.exe bash "${scriptPath}" & pause'`,
      ], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch { /* powershell.exe not available */ }

    return false;
  }

  private tryOpenLinux(scriptPath: string): boolean {
    const terminals: Array<[string, string[]]> = [
      ['gnome-terminal', ['--', 'bash', scriptPath]],
      ['konsole',        ['--hold', '-e', 'bash', scriptPath]],
      ['xterm',          ['-e', `bash "${scriptPath}"`]],
      ['x-terminal-emulator', ['-e', `bash "${scriptPath}"`]],
    ];

    for (const [bin, args] of terminals) {
      try {
        execSync(`command -v ${bin} 2>/dev/null`, { timeout: 1000 });
        spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch { /* not found, try next */ }
    }

    // Last resort: spawn bash without a new window (headless CI / no display)
    try {
      spawn('bash', [scriptPath], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch {
      return false;
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private resolveClaudePath(): string {
    const candidates = [
      'claude',
      '/home/mohantn/.local/bin/claude',
      '/usr/local/bin/claude',
      `${os.homedir()}/.npm-global/bin/claude`,
      `${os.homedir()}/.npm-packages/bin/claude`,
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
    }
    try {
      const resolved = execSync('which claude 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
      if (resolved) return resolved;
    } catch { /* ignore */ }
    return 'claude';
  }

  private isWSL(): boolean {
    if (process.env['WSL_DISTRO_NAME']) return true;
    try {
      const v = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
      return v.includes('microsoft') || v.includes('wsl');
    } catch {
      return false;
    }
  }

  private async fetchAnalysis(): Promise<FileAnalysis | null> {
    try {
      const url = `${VIZ_API}/api/file-detail?file=${encodeURIComponent(this.filePath)}&repo=${encodeURIComponent(this.repo)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as { analysis?: FileAnalysis };
      return data.analysis ?? null;
    } catch {
      return null;
    }
  }

  private async reanalyze(): Promise<FileAnalysis | null> {
    try {
      const res = await fetch(`${DAEMON_IPC}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: this.filePath, repoRoot: this.repo }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { analysis?: FileAnalysis };
      return data.analysis ?? null;
    } catch {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
