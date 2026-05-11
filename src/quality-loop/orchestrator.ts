import * as fs from 'fs';
import * as path from 'path';
import { SqliteCache } from '../cache/sqlite-cache';
import { QueueManager } from './queue-manager';
import { FileLockManager } from './file-lock';
import { FixWorker } from './fix-worker';
import { QualityLoopConfig, WorkerResult, WSMessage } from '../types';

const QUALITY_CONFIG_PATH = path.join(process.env.HOME ?? '/tmp', '.gate-keeper', 'quality-config.json');

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

  private activeWorkers = new Map<string, {
    queueId: number;
    filePath: string;
    promise: Promise<void>;
    startTime: number;
    timeout: NodeJS.Timeout;
  }>();
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
    return this.cache.quality.getTrends();
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
