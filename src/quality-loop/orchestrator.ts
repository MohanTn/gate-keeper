import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync, ChildProcess } from 'child_process';
import { SqliteCache } from '../cache/sqlite-cache';
import { QueueManager } from './queue-manager';
import { FileLockManager } from './file-lock';
import { FixWorker } from './fix-worker';
import { QualityLoopConfig, WorkerResult, WSMessage } from '../types';

const QUALITY_CONFIG_PATH = path.join(process.env.HOME ?? '/tmp', '.gate-keeper', 'quality-config.json');

/** A manual execution triggered from the dashboard — opens a real terminal window */
interface ManualExecution {
  workerId: string;
  queueId: number;
  filePath: string;
  repo: string;
  outputFile: string;
  statusFile: string;
  scriptFile: string;
  promptFile: string;
  startTime: number;
  running: boolean;
  exitCode: number | null;
  pollTimer?: NodeJS.Timeout;
}

interface OrchestratorCallbacks {
  broadcast: (msg: WSMessage, repoFilter?: string) => void;
  getAnalyzedFiles: (repo: string) => Array<{ path: string; rating: number; repoRoot: string }>;
}

export class QualityOrchestrator {
  private config: QualityLoopConfig;
  private cache: SqliteCache;
  private queue: QueueManager;
  private locks: FileLockManager;
  private callbacks: OrchestratorCallbacks;

  /** Tracks auto-scheduled workers (orchestrator-driven) */
  private activeWorkers = new Map<string, {
    queueId: number;
    filePath: string;
    promise: Promise<void>;
    startTime: number;
    timeout: NodeJS.Timeout;
  }>();

  /** Tracks manual executions triggered from the dashboard */
  private manualExecutions = new Map<string, ManualExecution>();

  private paused = false;
  private stopped = false;
  private checkpointTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private loopPromise: Promise<void> | null = null;
  private filesFixed = 0;
  private workerCounter = 0;

  constructor(config: QualityLoopConfig, cache: SqliteCache, callbacks: OrchestratorCallbacks) {
    this.config = config;
    this.cache = cache;
    this.queue = new QueueManager(cache);
    this.locks = new FileLockManager(cache);
    this.callbacks = callbacks;
  }

  get isRunning(): boolean {
    return this.loopPromise !== null && !this.stopped;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get stats() {
    return this.queue.getStats();
  }

  start(): void {
    if (this.loopPromise) {
      console.error('[quality-loop] Already running');
      return;
    }
    this.stopped = false;
    this.paused = false;
    this.loopPromise = this.run();
    this.loopPromise.catch(err => {
      console.error('[quality-loop] Fatal loop error:', err);
      this.stop();
    });
    console.error('[quality-loop] Orchestrator started');
  }

  stop(): void {
    this.stopped = true;
    console.error('[quality-loop] Stopping...');
  }

  pause(): void {
    this.paused = true;
    console.error('[quality-loop] Paused');
  }

  resume(): void {
    this.paused = false;
    console.error('[quality-loop] Resumed');
  }

  enqueueRepos(): Promise<number> {
    return this.buildQueue();
  }

  resetFailed(): number {
    return this.queue.resetFailed();
  }

  getQueueItems() {
    return this.queue.getAllItems();
  }

  getAttempts(queueId: number) {
    return this.cache.quality.getAttemptLogWithOutput(queueId);
  }

  getTrends() {
    const rows = this.cache.quality.getTrends();
    return rows.map(r => ({
      id: r.id,
      repo: r.repo,
      overallRating: r.overall_rating,
      filesTotal: r.files_total,
      filesPassed: r.files_passed,
      filesFailed: r.files_failed,
      filesPending: r.files_pending,
      recordedAt: r.recorded_at,
    }));
  }

  updateConfig(partial: Partial<QualityLoopConfig>): void {
    if (partial.threshold != null) this.config.threshold = partial.threshold;
    if (partial.maxWorkers != null) this.config.maxWorkers = partial.maxWorkers;
    if (partial.maxAttemptsPerFile != null) this.config.maxAttemptsPerFile = partial.maxAttemptsPerFile;
    if (partial.workerMode != null) this.config.workerMode = partial.workerMode;
    if (partial.repos != null) this.config.repos = partial.repos;
    if (partial.checkpointIntervalSec != null) this.config.checkpointIntervalSec = partial.checkpointIntervalSec;
    if (partial.heartbeatIntervalSec != null) this.config.heartbeatIntervalSec = partial.heartbeatIntervalSec;
    // Persist to disk
    try {
      fs.writeFileSync(QUALITY_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    } catch { /* non-fatal */ }
    this.log(`Config updated: threshold=${this.config.threshold} workers=${this.config.maxWorkers}`);
  }

  getConfig(): QualityLoopConfig {
    return { ...this.config };
  }

  // ── Manual execution (dashboard-triggered) ──────────────────────────────────

  /**
   * Look up repo metadata to determine session type.
   * Returns 'claude', 'github-copilot', or 'unknown'.
   */
  getRepoSessionType(repo: string): string {
    try {
      const meta = this.cache.getRepositoryByPath(repo);
      return meta?.sessionType ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Generate a human-readable command string for a queue item.
   */
  getCmdForItem(itemId: number): { cmd: string; sessionType: string } | null {
    const item = this.queue.getItem(itemId);
    if (!item) return null;
    const sessionType = this.getRepoSessionType(item.repo);
    const shortFile = path.basename(item.filePath);
    if (sessionType === 'github-copilot') {
      return { cmd: `gh copilot suggest "fix violations in ${shortFile}"`, sessionType };
    }
    return {
      cmd: `claude --dangerously-skip-permissions "fix all violations in @${shortFile}"`,
      sessionType,
    };
  }

  /**
   * Execute a single queue item manually from the dashboard.
   * Opens a real terminal window and polls a status file for completion.
   */
  async executeItem(itemId: number): Promise<{ ok: boolean; workerId: string | null; error?: string }> {
    const item = this.queue.getItem(itemId);
    if (!item) return { ok: false, workerId: null, error: 'Queue item not found' };
    if (item.status === 'in_progress') return { ok: false, workerId: null, error: 'Item already in progress' };

    // Mark as in_progress
    const workerId = `manual-${itemId}-${Date.now()}`;
    this.queue.markInProgress(itemId, workerId);
    this.broadcastItem(itemId);

    // Generate the fix prompt
    const prompt = await this.generateFixPrompt(item.filePath, item.repo);
    if (!prompt) {
      this.queue.markFailed(itemId, 'Could not generate fix prompt');
      this.broadcastItem(itemId);
      return { ok: false, workerId: null, error: 'Could not fetch analysis for file' };
    }

    const sessionType = this.getRepoSessionType(item.repo);
    const claudePath = this.resolveClaudePath();

    // Write prompt + bash script to temp files
    const id = `gk-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tmp = os.tmpdir();
    const promptFile = path.join(tmp, `${id}.prompt`);
    const statusFile = path.join(tmp, `${id}.status`);
    const logFile = path.join(tmp, `${id}.log`);
    const scriptFile = path.join(tmp, `${id}.sh`);
    try {
      fs.writeFileSync(promptFile, prompt, 'utf8');
      this.writeTerminalScript(scriptFile, { promptFile, statusFile, logFile, claudePath, repo: item.repo, sessionType });
    } catch (err) {
      this.queue.markFailed(itemId, 'Could not write script files');
      this.broadcastItem(itemId);
      return { ok: false, workerId: null, error: 'Could not write script files' };
    }

    this.log(`Manual execute: ${claudePath} for ${path.basename(item.filePath)} (${sessionType})`);

    // Open a real terminal window
    const opened = this.openTerminal(scriptFile);
    if (!opened) {
      this.queue.markFailed(itemId, 'Could not open terminal');
      this.broadcastItem(itemId);
      this.cleanupFiles(promptFile, statusFile, logFile, scriptFile);
      return { ok: false, workerId: null, error: 'Could not open terminal' };
    }

    const execution: ManualExecution = {
      workerId,
      queueId: itemId,
      filePath: item.filePath,
      repo: item.repo,
      outputFile: logFile,
      statusFile,
      scriptFile,
      promptFile,
      startTime: Date.now(),
      running: true,
      exitCode: null,
    };

    this.manualExecutions.set(workerId, execution);

    // Poll for completion in the background
    this.pollManualCompletion(workerId);

    return { ok: true, workerId };
  }

  /**
   * Cancel a running manual execution by writing an abort marker to the status file.
   * The polling loop detects it and cleans up.
   */
  cancelExecution(workerId: string): boolean {
    const exec = this.manualExecutions.get(workerId);
    if (!exec || !exec.running) return false;
    exec.running = false;
    exec.exitCode = -1;
    if (exec.pollTimer) clearInterval(exec.pollTimer);
    // Write cancelled marker so polling loop won't treat it as a real exit
    try {
      fs.writeFileSync(exec.statusFile, JSON.stringify({ exitCode: -1, timestamp: Math.floor(Date.now() / 1000) }), 'utf8');
    } catch { /* ignore */ }
    this.queue.markFailed(exec.queueId, 'Cancelled by user');
    this.broadcastItem(exec.queueId);
    this.cleanupFiles(exec.outputFile, exec.statusFile, exec.scriptFile, exec.promptFile);
    this.manualExecutions.delete(workerId);
    this.log(`Manual execution cancelled: ${workerId}`);
    return true;
  }

  /**
   * Delete a queue item (remove from database).
   */
  deleteQueueItem(itemId: number): boolean {
    for (const [wid, exec] of this.manualExecutions) {
      if (exec.queueId === itemId && exec.running) {
        exec.running = false;
        exec.exitCode = -1;
        if (exec.pollTimer) clearInterval(exec.pollTimer);
        try {
          fs.writeFileSync(exec.statusFile, JSON.stringify({ exitCode: -1, timestamp: Math.floor(Date.now() / 1000) }), 'utf8');
        } catch { /* ignore */ }
        this.manualExecutions.delete(wid);
      }
    }
    try {
      this.cache.quality.updateQueueItem(itemId, { status: 'skipped' });
      this.broadcast({ type: 'queue_update' as const, queueItem: this.queue.getItem(itemId) ?? undefined });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current output of a running manual execution.
   */
  getExecutionOutput(workerId: string): { output: string; running: boolean; exitCode: number | null; startTime: number } | null {
    const exec = this.manualExecutions.get(workerId);
    if (!exec) return null;
    return {
      output: this.readOutputFile(exec.outputFile),
      running: exec.running,
      exitCode: exec.exitCode,
      startTime: exec.startTime,
    };
  }

  // ── Manual execution helpers ─────────────────────────────────────────────────

  private async generateFixPrompt(filePath: string, repo: string): Promise<string | null> {
    try {
      const url = `http://127.0.0.1:5378/api/file-detail?file=${encodeURIComponent(filePath)}&repo=${encodeURIComponent(repo)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as { analysis?: { rating: number; violations: Array<{ severity: string; line?: number; message: string; fix?: string }> } };
      if (!data.analysis) return null;

      const { rating, violations } = data.analysis;
      const numbered = violations.map((v, i) => {
        const fixStr = typeof v.fix === 'string' ? v.fix : '';
        return `${i + 1}. [${v.severity.toUpperCase()}]${v.line ? ` (line ${v.line})` : ''}: ${v.message}${fixStr ? `\n   Fix: ${fixStr}` : ''}`;
      }).join('\n');

      return `fix all violations in @${filePath}\nFile: ${filePath}\nRating: ${rating}/10\nViolations: ${violations.length}\n\n${numbered}`;
    } catch {
      return null;
    }
  }

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

  private async reanalyzeFile(filePath: string, repo: string): Promise<{ rating: number; violations: Array<unknown> } | null> {
    try {
      const res = await fetch(`http://127.0.0.1:5379/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, repoRoot: repo }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { analysis?: { rating: number; violations: Array<unknown> } };
      return data.analysis ?? null;
    } catch {
      return null;
    }
  }

  private readOutputFile(filePath: string): string {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }

  private cleanupFiles(...files: string[]): void {
    for (const f of files) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }

  // ── Terminal helpers (reuse the same pattern as FixWorker) ────────────────────

  /** Write the bash script that will run inside the terminal window. */
  private writeTerminalScript(
    scriptPath: string,
    opts: { promptFile: string; statusFile: string; logFile: string; claudePath: string; repo: string; sessionType: string },
  ): void {
    const cmd = opts.sessionType === 'github-copilot'
      ? `gh copilot suggest "fix violations in $(cat '${opts.promptFile}')"`
      : `"${opts.claudePath}" --dangerously-skip-permissions "$(cat '${opts.promptFile}')"`;

    fs.writeFileSync(scriptPath, `#!/usr/bin/env bash
# Note: this script is invoked via "bash -i" so ~/.bashrc is sourced automatically.
set -uo pipefail

STATUS_FILE='${opts.statusFile}'
LOG_FILE='${opts.logFile}'
REPO='${opts.repo}'

EXIT_CODE=0

on_exit() {
  local last=$?
  [ "$last" -ne 0 ] && [ "$EXIT_CODE" -eq 0 ] && EXIT_CODE=$last
  printf '{"exitCode":%d,"timestamp":%d}' "$EXIT_CODE" "$(date +%s)" > "$STATUS_FILE" 2>/dev/null || true
}
trap on_exit EXIT

cd "$REPO"

${cmd} 2>&1 | tee "$LOG_FILE" || EXIT_CODE=$?

echo ""
echo "────────────────────────────────────────────"
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "  Claude fix finished — press Enter to close"
else
  echo "  Claude exited with code $EXIT_CODE — press Enter to close"
fi
echo "────────────────────────────────────────────"
read -r || true
`, 'utf8');

    fs.chmodSync(scriptPath, 0o755);
  }

  /** Open a real terminal window running the given script. */
  private openTerminal(scriptPath: string): boolean {
    if (this.isWSL()) {
      // Strategy 1: cmd.exe /c start — opens a new CMD window (most reliable on WSL)
      // Use cmd /k to keep the window open after the script exits
      try {
        spawn('cmd.exe', ['/c', 'start', '', 'cmd', '/k', 'wsl.exe', 'bash', '-i', scriptPath], { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch { /* try next */ }

      // Strategy 2: Windows Terminal (wt.exe)
      try {
        execSync('command -v wt.exe 2>/dev/null', { timeout: 1000 });
        spawn('wt.exe', ['-w', '0', 'nt', '--', 'wsl.exe', 'bash', '-i', scriptPath], { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch { /* try next */ }

      // Strategy 3: powershell Start-Process
      try {
        spawn('powershell.exe', ['-NoProfile', '-Command',
          `Start-Process cmd -ArgumentList '/k wsl.exe bash -i \\"${scriptPath}\\"'`],
        { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch { return false; }
    }

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
      } catch { /* not found */ }
    }

    return false;
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

  /** Poll the status file every 3 seconds until the terminal script writes a result. */
  private pollManualCompletion(workerId: string): void {
    const exec = this.manualExecutions.get(workerId);
    if (!exec) return;

    const startTime = Date.now();
    const POLL_MS = 3000;
    const MAX_WAIT = 600_000; // 10 minutes for manual execution

    const poll = async () => {
      const e = this.manualExecutions.get(workerId);
      if (!e || !e.running) return;

      // Timeout check
      if (Date.now() - startTime > MAX_WAIT) {
        e.running = false;
        e.exitCode = null;
        this.queue.markFailed(e.queueId, 'Manual execution timed out');
        this.broadcastItem(e.queueId);
        this.cleanupFiles(e.outputFile, e.statusFile, e.scriptFile, e.promptFile);
        this.manualExecutions.delete(workerId);
        return;
      }

      // Check status file
      let status: { exitCode: number; timestamp: number } | null = null;
      try {
        if (fs.existsSync(e.statusFile)) {
          status = JSON.parse(fs.readFileSync(e.statusFile, 'utf8'));
        }
      } catch { /* not written yet */ }

      if (status !== null) {
        clearInterval(e.pollTimer);
        e.running = false;
        e.exitCode = status.exitCode;

        const fullOutput = this.readOutputFile(e.outputFile);
        const analysis = await this.reanalyzeFile(e.filePath, e.repo);
        const newRating = analysis?.rating ?? 0;
        const violationsRemaining = analysis?.violations.length ?? 0;

        this.cache.quality.logAttempt({
          queueId: e.queueId,
          attempt: 1, // approximate
          ratingBefore: 0,
          ratingAfter: newRating,
          violationsFixed: 0,
          violationsRemaining,
          fixSummary: status.exitCode === 0 ? `Manual fix completed (exit ${status.exitCode})` : `Manual fix failed (exit ${status.exitCode})`,
          errorMessage: status.exitCode !== 0 ? `Process exited with code ${status.exitCode}` : undefined,
          durationMs: Date.now() - e.startTime,
          workerOutput: fullOutput,
        });

        if (status.exitCode === 0 && newRating >= this.config.threshold) {
          this.queue.markCompleted(e.queueId, newRating);
        } else if (status.exitCode !== 0) {
          this.queue.markFailed(e.queueId, `Manual fix exited with code ${status.exitCode}`);
        } else {
          this.queue.markFailed(e.queueId, `Rating ${newRating} below threshold ${this.config.threshold}`);
        }

        this.broadcastItem(e.queueId);
        this.cleanupFiles(e.outputFile, e.statusFile, e.scriptFile, e.promptFile);
        this.manualExecutions.delete(workerId);
      }
    };

    exec.pollTimer = setInterval(poll, POLL_MS);
  }

  private async run(): Promise<void> {
    this.log('Quality loop started');

    // 1. Try restore from checkpoint
    const restored = this.queue.restoreFromCheckpoint();
    if (restored.length > 0) {
      this.log(`Restored ${restored.length} items from checkpoint`);
    }

    // 2. Build queue from repos
    await this.buildQueue();

    // 3. Start timers
    this.startHeartbeat();
    this.startCheckpoints();

    // 4. Main loop
    while (!this.stopped) {
      if (this.paused) {
        await this.sleep(2000);
        continue;
      }

      // Clean stale locks
      this.locks.clearStale();

      // Get stats
      const stats = this.queue.getStats();
      this.broadcastProgress(stats);

      // Check completion
      if (stats.pending === 0 && stats.inProgress === 0) {
        if (stats.failed > 0 || stats.skipped > 0) {
          this.log(`Loop complete: ${stats.completed} passed, ${stats.failed} failed, ${stats.skipped} skipped`);
        } else {
          this.log(`ALL ${stats.completed} files pass threshold!`);
        }
        await this.saveFinalCheckpoint('complete');
        break;
      }

      // Calculate available slots
      const slots = this.config.maxWorkers - this.activeWorkers.size;
      if (slots <= 0) {
        await this.waitForAnyWorker();
        continue;
      }

      // Pick next files
      const candidates = this.queue.pickNext(slots, this.locks.getLockedPaths());
      if (candidates.length === 0) {
        // All pending files are locked — wait
        await this.sleep(1000);
        continue;
      }

      // Spawn workers
      for (const item of candidates) {
        if (this.stopped) break;

        const workerId = `w${++this.workerCounter}-${item.id}`;
        if (!this.locks.acquire(item.filePath, workerId)) continue;

        this.queue.markInProgress(item.id, workerId);
        this.broadcastItem(item.id);

        const workerStartTime = Date.now();

        const promise = this.runWorker(item.id, item.filePath, workerId, workerStartTime);
        const timeout = setTimeout(() => {
          this.log(`Worker ${workerId} timed out for ${path.basename(item.filePath)}`);
          this.handleWorkerTimeout(workerId);
        }, 300_000); // 5 min hard limit

        this.activeWorkers.set(workerId, {
          queueId: item.id,
          filePath: item.filePath,
          promise,
          startTime: workerStartTime,
          timeout,
        });

        this.broadcast({
          type: 'worker_activity',
          workerAction: 'start',
          workerFilePath: item.filePath,
          workerId,
        });

        // Handle completion
        promise.finally(() => {
          clearTimeout(timeout);
          this.activeWorkers.delete(workerId);
        });
      }

      // Wait for a worker slot if all full
      if (this.activeWorkers.size >= this.config.maxWorkers) {
        await this.waitForAnyWorker();
      } else {
        await this.sleep(500);
      }
    }

    // 5. Shutdown
    this.cleanup();
  }

  private async runWorker(queueId: number, filePath: string, workerId: string, startTime: number): Promise<void> {
    let result: WorkerResult;
    try {
      const worker = new FixWorker({
        filePath,
        repo: this.resolveRepo(filePath),
        threshold: this.config.threshold,
      });

      result = await worker.fix();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        success: false,
        newRating: 0,
        ratingBefore: 0,
        violationsRemaining: 0,
        violationsFixed: 0,
        durationMs: Date.now() - startTime,
        attemptNumber: 0,
        fixSummary: '',
        error: message,
        shouldRetry: false,
      };
    }

    // Release file lock
    this.locks.release(filePath, workerId);

    // Log attempt
    this.cache.quality.logAttempt({
      queueId,
      attempt: result.attemptNumber,
      ratingBefore: result.ratingBefore,
      ratingAfter: result.newRating,
      violationsFixed: result.violationsFixed,
      violationsRemaining: result.violationsRemaining,
      fixSummary: result.fixSummary,
      errorMessage: result.error,
      durationMs: result.durationMs,
      workerOutput: result.workerOutput,
    });

    // Update queue item
    if (result.success) {
      this.queue.markCompleted(queueId, result.newRating);
      this.filesFixed++;
    } else {
      this.queue.markFailed(queueId, result.error || 'Unknown error');
    }

    // Record trend
    const stats = this.queue.getStats();
    this.queue.recordTrend(this.config.repos.join(','), this.getOverallRating(), this.getTotalFiles(), stats);

    // Broadcast
    this.broadcast({
      type: 'worker_activity',
      workerAction: result.success ? 'complete' : 'error',
      workerFilePath: filePath,
      workerId,
      workerRating: result.newRating,
      workerSuccess: result.success,
      workerError: result.error,
    });
    this.broadcastItem(queueId);

    const relPath = path.basename(filePath);
    if (result.success) {
      this.log(`[OK] ${relPath}: ${result.ratingBefore} → ${result.newRating} (${result.durationMs}ms, ${result.attemptNumber} cycle(s))`);
    } else {
      this.log(`[FAIL] ${relPath}: ${result.ratingBefore} → ${result.newRating} — ${result.error ?? 'Max attempts'} (${result.durationMs}ms)`);
    }
  }

  private resolveRepo(filePath: string): string {
    // Find the best matching repo from config
    for (const repo of this.config.repos) {
      if (filePath.startsWith(repo)) return repo;
    }
    return this.config.repos[0] ?? path.dirname(filePath);
  }

  private handleWorkerTimeout(workerId: string): void {
    const worker = this.activeWorkers.get(workerId);
    if (!worker) return;
    this.locks.release(worker.filePath, workerId);
    this.activeWorkers.delete(workerId);
  }

  private async buildQueue(): Promise<number> {
    const fileRatings = new Map<string, { rating: number; repo: string }>();
    const violationCounts = new Map<string, { errors: number; warnings: number; info: number }>();

    for (const repo of this.config.repos) {
      const analyses = this.callbacks.getAnalyzedFiles(repo);
      for (const a of analyses) {
        if (a.rating < this.config.threshold) {
          fileRatings.set(a.path, { rating: a.rating, repo: repo });
        }
      }
    }

    this.log(`Found ${fileRatings.size} files below threshold ${this.config.threshold}`);

    if (fileRatings.size === 0) return 0;

    return this.queue.buildQueue({
      repos: this.config.repos,
      threshold: this.config.threshold,
      fileRatings,
      violationCounts,
    });
  }

  private startHeartbeat(): void {
    const interval = (this.config.heartbeatIntervalSec ?? 10) * 1000;
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped) return;
      const stats = this.queue.getStats();
      this.broadcastProgress(stats);
    }, interval);
  }

  private startCheckpoints(): void {
    const interval = (this.config.checkpointIntervalSec ?? 30) * 1000;
    this.checkpointTimer = setInterval(() => {
      if (this.stopped) return;
      this.queue.saveCheckpoint('heartbeat', this.filesFixed, this.getOverallRating());
    }, interval);
  }

  private async saveFinalCheckpoint(reason: string): Promise<void> {
    this.queue.saveCheckpoint(reason, this.filesFixed, this.getOverallRating());
    const stats = this.queue.getStats();
    this.broadcast({
      type: 'queue_progress',
      queueStats: {
        total: stats.total,
        pending: stats.pending,
        inProgress: stats.inProgress,
        completed: stats.completed,
        failed: stats.failed,
        skipped: stats.skipped,
      },
      queueOverallRating: this.getOverallRating(),
      queueDone: true,
    });
  }

  private broadcastProgress(stats: ReturnType<QueueManager['getStats']>): void {
    this.broadcast({
      type: 'queue_progress',
      queueStats: {
        total: stats.total,
        pending: stats.pending,
        inProgress: stats.inProgress,
        completed: stats.completed,
        failed: stats.failed,
        skipped: stats.skipped,
      },
      queueOverallRating: this.getOverallRating(),
      queueDone: stats.pending === 0 && stats.inProgress === 0,
    });
  }

  private broadcastItem(itemId: number): void {
    const item = this.queue.getItem(itemId);
    if (!item) return;
    this.broadcast({ type: 'queue_update', queueItem: item });
  }

  private broadcast(msg: WSMessage): void {
    try {
      this.callbacks.broadcast(msg);
    } catch {
      // Broadcast failures are non-fatal
    }
  }

  private async waitForAnyWorker(): Promise<void> {
    if (this.activeWorkers.size === 0) return;
    // Wait for first worker to complete
    const workers = Array.from(this.activeWorkers.values());
    await Promise.race(workers.map(w => w.promise));
  }

  private getOverallRating(): number {
    try {
      const all = this.cache.getAll();
      if (all.length === 0) return 10;
      const sum = all.reduce((a, f) => a + f.rating, 0);
      return Math.round((sum / all.length) * 10) / 10;
    } catch {
      return 10;
    }
  }

  private getTotalFiles(): number {
    try {
      const all = this.cache.getAll();
      return all.length;
    } catch {
      return 0;
    }
  }

  private cleanup(): void {
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.checkpointTimer = null;
    this.heartbeatTimer = null;

    // Kill any remaining workers (just timeouts)
    for (const [id, w] of this.activeWorkers) {
      clearTimeout(w.timeout);
      this.locks.release(w.filePath, id);
    }
    this.activeWorkers.clear();
    this.locks.clearStale();

    this.log('Shutdown complete');
    this.loopPromise = null;
  }

  private log(msg: string): void {
    console.error(`[quality-loop] ${msg}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

// Load config from disk
export function loadQualityConfig(): QualityLoopConfig {
  try {
    if (fs.existsSync(QUALITY_CONFIG_PATH)) {
      const raw = fs.readFileSync(QUALITY_CONFIG_PATH, 'utf8');
      return JSON.parse(raw) as QualityLoopConfig;
    }
  } catch (err) {
    console.error(`[quality-loop] Failed to load config: ${err}`);
  }

  return {
    threshold: 7.0,
    maxWorkers: 2,
    maxAttemptsPerFile: 3,
    workerMode: 'auto',
    repos: [],
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    checkpointIntervalSec: 30,
    heartbeatIntervalSec: 10,
  };
}

// Save config to disk
export function saveQualityConfig(config: QualityLoopConfig): void {
  const dir = path.dirname(QUALITY_CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(QUALITY_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}
