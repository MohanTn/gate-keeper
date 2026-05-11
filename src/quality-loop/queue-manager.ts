import { SqliteCache } from '../cache/sqlite-cache';
import { QueueItem, QueueStats } from '../types';

type QueueRow = {
  id: number;
  repo: string;
  file_path: string;
  current_rating: number;
  target_rating: number;
  priority_score: number;
  status: QueueItem['status'];
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  locked_at: number | null;
  error_message: string | null;
  completed_at: number | null;
  created_at: number;
};

export interface BuildQueueOptions {
  repos: string[];
  threshold: number;
  /** Map of filePath -> currentRating for files already scanned */
  fileRatings: Map<string, { rating: number; repo: string }>;
  /** Map of filePath -> depth in dependency graph (leaf = 0) */
  dependencyDepth?: Map<string, number>;
  /** Map of filePath -> violation counts */
  violationCounts?: Map<string, { errors: number; warnings: number; info: number }>;
}

export class QueueManager {
  private cache: SqliteCache;

  constructor(cache: SqliteCache) {
    this.cache = cache;
  }

  /**
   * Build/rebuild the queue with all files below the threshold.
   * Replaces existing pending items; preserves in_progress/completed/failed items.
   */
  buildQueue(opts: BuildQueueOptions): number {
    let enqueued = 0;
    const maxDepth = opts.dependencyDepth
      ? Math.max(1, ...opts.dependencyDepth.values())
      : 1;

    for (const [filePath, info] of opts.fileRatings) {
      if (info.rating >= opts.threshold) continue;

      const depth = opts.dependencyDepth?.get(filePath) ?? 0;
      const vc = opts.violationCounts?.get(filePath);
      const severityWeight = vc
        ? vc.errors * 15 + vc.warnings * 5 + vc.info * 1
        : 0;

      // Priority: worst-rated first (dominant), then leaf-first, then most violations
      const priorityScore =
        (opts.threshold - info.rating) * 100 +
        (maxDepth - depth) * 10 +
        severityWeight;

      this.cache.quality.enqueueFile(info.repo, filePath, info.rating, opts.threshold, priorityScore);
      enqueued++;
    }

    return enqueued;
  }

  /**
   * Pick the next N files for processing, excluding locked files.
   */
  pickNext(count: number, excludePaths: Set<string>): QueueItem[] {
    const items = this.cache.quality.getQueue('pending') as QueueRow[];
    const picked: QueueItem[] = [];

    for (const row of items) {
      if (picked.length >= count) break;
      if (excludePaths.has(row.file_path)) continue;
      picked.push(this.rowToItem(row));
    }

    return picked;
  }

  markInProgress(itemId: number, workerId: string): void {
    this.cache.quality.updateQueueItem(itemId, {
      status: 'in_progress',
      worker_id: workerId,
      locked_at: Date.now(),
    });
  }

  markCompleted(itemId: number, newRating: number): void {
    this.cache.quality.updateQueueItem(itemId, {
      status: 'completed',
      current_rating: newRating,
      worker_id: null,
      locked_at: null,
      completed_at: Date.now(),
    });
  }

  markFailed(itemId: number, error: string): void {
    const item = this.cache.quality.getQueueItem(itemId) as QueueRow | undefined;
    const attempts = (item?.attempts ?? 0) + 1;
    const maxAttempts = item?.max_attempts ?? 3;

    if (attempts >= maxAttempts) {
      this.cache.quality.updateQueueItem(itemId, {
        status: 'skipped',
        attempts,
        error_message: error,
        worker_id: null,
        locked_at: null,
      });
    } else {
      this.cache.quality.updateQueueItem(itemId, {
        status: 'pending',
        attempts,
        error_message: error,
        worker_id: null,
        locked_at: null,
      });
    }
  }

  markSkipped(itemId: number, error: string): void {
    this.cache.quality.updateQueueItem(itemId, {
      status: 'skipped',
      error_message: error,
      worker_id: null,
      locked_at: null,
    });
  }

  resetFailed(): number {
    const failed = this.cache.quality.getQueue('failed') as QueueRow[];
    const skipped = this.cache.quality.getQueue('skipped') as QueueRow[];
    const all = [...failed, ...skipped];
    for (const item of all) {
      this.cache.quality.updateQueueItem(item.id, {
        status: 'pending',
        attempts: 0,
        error_message: null,
      });
    }
    return all.length;
  }

  getAllItems(): QueueItem[] {
    const rows = this.cache.quality.getQueue() as QueueRow[];
    return rows.map(r => this.rowToItem(r));
  }

  getItem(itemId: number): QueueItem | null {
    const row = this.cache.quality.getQueueItem(itemId) as QueueRow | undefined;
    return row ? this.rowToItem(row) : null;
  }

  getStats(): QueueStats {
    const s = this.cache.quality.getQueueStats();
    return {
      total: s.total,
      pending: s.pending,
      inProgress: s.in_progress,
      completed: s.completed,
      failed: s.failed,
      skipped: s.skipped,
    };
  }

  recordTrend(repo: string, overallRating: number, filesTotal: number, stats: QueueStats): void {
    this.cache.quality.recordTrend(
      repo,
      overallRating,
      filesTotal,
      stats.completed,
      stats.failed + stats.skipped,
      stats.pending + stats.inProgress
    );
  }

  saveCheckpoint(reason: string, filesFixed: number, overallRating: number): void {
    const snapshot = this.cache.quality.getQueue();
    this.cache.quality.saveCheckpoint(reason, JSON.stringify(snapshot), filesFixed, overallRating);
  }

  restoreFromCheckpoint(): QueueItem[] {
    const cp = this.cache.quality.getLatestCheckpoint();
    if (!cp || cp.reason !== 'interrupted') return [];
    const items = JSON.parse(cp.queue_snapshot) as QueueRow[];
    // Reset in_progress back to pending for resume
    for (const item of items) {
      if (item.status === 'in_progress') {
        this.cache.quality.updateQueueItem(item.id, {
          status: 'pending',
          worker_id: null,
          locked_at: null,
        });
      }
    }
    return items.map(r => this.rowToItem(r));
  }

  private rowToItem(row: QueueRow): QueueItem {
    return {
      id: row.id,
      repo: row.repo,
      filePath: row.file_path,
      currentRating: row.current_rating,
      targetRating: row.target_rating,
      priorityScore: row.priority_score,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      workerId: row.worker_id,
      lockedAt: row.locked_at,
      errorMessage: row.error_message,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }
}
