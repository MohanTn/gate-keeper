import Database from 'better-sqlite3';

interface QueueRow {
  id: number; repo: string; file_path: string; current_rating: number; target_rating: number;
  priority_score: number; status: string; attempts: number; max_attempts: number;
  worker_id: string | null; locked_at: number | null; error_message: string | null;
  completed_at: number | null; created_at: number;
}

interface AttemptLogRow {
  id: number; queue_id: number; attempt: number; rating_before: number; rating_after: number | null;
  violations_fixed: number; violations_remaining: number; fix_summary: string | null;
  error_message: string | null; duration_ms: number | null; created_at: number;
}

interface AttemptLogRowWithOutput extends AttemptLogRow {
  worker_output: string | null;
}

interface TrendRow {
  id: number; repo: string; overall_rating: number; files_total: number;
  files_passed: number; files_failed: number; files_pending: number; recorded_at: number;
}

interface CheckpointRow {
  id: number; reason: string; queue_snapshot: string; files_fixed: number; overall_rating: number; created_at: number;
}

interface FileLockRow {
  file_path: string; worker_id: string; locked_at: number;
}

interface QueueStatsRow {
  status: string; cnt: number;
}

interface QueueStats {
  total: number; pending: number; in_progress: number; completed: number; failed: number; skipped: number;
}

export class QualityCache {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  enqueueFile(repo: string, filePath: string, currentRating: number, targetRating: number, priorityScore: number): void {
    this.db.prepare(`
      INSERT INTO quality_queue (repo, file_path, current_rating, target_rating, priority_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo, file_path) DO UPDATE SET
        current_rating = excluded.current_rating,
        target_rating = excluded.target_rating,
        priority_score = excluded.priority_score,
        status = CASE WHEN quality_queue.status = 'pending' THEN 'pending' ELSE quality_queue.status END
    `).run(repo, filePath, currentRating, targetRating, priorityScore, Date.now());
  }

  getQueue(statusFilter?: string, repoFilter?: string): Array<{
    id: number; repo: string; file_path: string; current_rating: number; target_rating: number;
    priority_score: number; status: string; attempts: number; max_attempts: number;
    worker_id: string | null; locked_at: number | null; error_message: string | null;
    completed_at: number | null; created_at: number;
  }> {
    let sql = 'SELECT * FROM quality_queue WHERE 1=1';
    const params: unknown[] = [];
    if (statusFilter) { sql += ' AND status = ?'; params.push(statusFilter); }
    if (repoFilter) { sql += ' AND repo = ?'; params.push(repoFilter); }
    sql += ' ORDER BY priority_score DESC';
    return this.db.prepare(sql).all(...params) as QueueRow[];
  }

  getQueueItem(itemId: number): QueueRow | undefined {
    return this.db.prepare('SELECT * FROM quality_queue WHERE id = ?').get(itemId) as QueueRow | undefined;
  }

  updateQueueItem(itemId: number, updates: Record<string, unknown>): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      params.push(val);
    }
    if (setClauses.length === 0) return;
    params.push(itemId);
    this.db.prepare(`UPDATE quality_queue SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  }

  logAttempt(entry: {
    queueId: number; attempt: number; ratingBefore: number; ratingAfter?: number;
    violationsFixed?: number; violationsRemaining?: number; fixSummary?: string;
    errorMessage?: string; durationMs?: number; workerOutput?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO quality_attempt_log (queue_id, attempt, rating_before, rating_after, violations_fixed, violations_remaining, fix_summary, error_message, duration_ms, worker_output, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.queueId, entry.attempt, entry.ratingBefore, entry.ratingAfter ?? null,
      entry.violationsFixed ?? 0, entry.violationsRemaining ?? 0,
      entry.fixSummary ?? null, entry.errorMessage ?? null, entry.durationMs ?? null,
      entry.workerOutput ?? null, Date.now()
    );
  }

  getAttemptLogWithOutput(queueId: number): Array<{
    id: number; queue_id: number; attempt: number; rating_before: number; rating_after: number | null;
    violations_fixed: number; violations_remaining: number; fix_summary: string | null;
    error_message: string | null; duration_ms: number | null; worker_output: string | null; created_at: number;
  }> {
    return this.db.prepare('SELECT * FROM quality_attempt_log WHERE queue_id = ? ORDER BY attempt ASC').all(queueId) as AttemptLogRowWithOutput[];
  }

  getAttemptLog(queueId: number): Array<{
    id: number; queue_id: number; attempt: number; rating_before: number; rating_after: number | null;
    violations_fixed: number; violations_remaining: number; fix_summary: string | null;
    error_message: string | null; duration_ms: number | null; created_at: number;
  }> {
    return this.db.prepare('SELECT * FROM quality_attempt_log WHERE queue_id = ? ORDER BY attempt ASC').all(queueId) as AttemptLogRow[];
  }

  recordTrend(repo: string, overallRating: number, filesTotal: number, filesPassed: number, filesFailed: number, filesPending: number): void {
    this.db.prepare(`
      INSERT INTO quality_trend (repo, overall_rating, files_total, files_passed, files_failed, files_pending, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(repo, overallRating, filesTotal, filesPassed, filesFailed, filesPending, Date.now());
  }

  getTrends(repo?: string, limit = 50): Array<{
    id: number; repo: string; overall_rating: number; files_total: number;
    files_passed: number; files_failed: number; files_pending: number; recorded_at: number;
  }> {
    let sql = 'SELECT * FROM quality_trend WHERE 1=1';
    const params: unknown[] = [];
    if (repo) { sql += ' AND repo = ?'; params.push(repo); }
    sql += ' ORDER BY recorded_at ASC LIMIT ?';
    params.push(limit);
    return this.db.prepare(sql).all(...params) as TrendRow[];
  }

  saveCheckpoint(reason: string, queueSnapshot: string, filesFixed: number, overallRating: number): void {
    this.db.prepare(`
      INSERT INTO quality_checkpoints (reason, queue_snapshot, files_fixed, overall_rating, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(reason, queueSnapshot, filesFixed, overallRating, Date.now());
  }

  getLatestCheckpoint(): { id: number; reason: string; queue_snapshot: string; files_fixed: number; overall_rating: number; created_at: number } | null {
    return this.db.prepare('SELECT * FROM quality_checkpoints ORDER BY created_at DESC LIMIT 1').get() as CheckpointRow | undefined ?? null;
  }

  acquireLock(filePath: string, workerId: string, ttlMs = 300_000): boolean {
    const existing = this.db.prepare('SELECT * FROM quality_file_locks WHERE file_path = ?').get(filePath) as FileLockRow | undefined;
    if (existing) {
      if (Date.now() - existing.locked_at > ttlMs) {
        this.db.prepare('DELETE FROM quality_file_locks WHERE file_path = ?').run(filePath);
      } else {
        return false;
      }
    }
    this.db.prepare('INSERT OR REPLACE INTO quality_file_locks (file_path, worker_id, locked_at) VALUES (?, ?, ?)').run(filePath, workerId, Date.now());
    return true;
  }

  releaseLock(filePath: string, workerId: string): void {
    this.db.prepare('DELETE FROM quality_file_locks WHERE file_path = ? AND worker_id = ?').run(filePath, workerId);
  }

  getQueueStats(): QueueStats {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as cnt FROM quality_queue GROUP BY status
    `).all() as QueueStatsRow[];
    const stats: QueueStats = { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0, skipped: 0 };
    for (const row of rows) {
      stats.total += row.cnt;
      (stats as unknown as Record<string, number>)[row.status] = row.cnt;
    }
    return stats;
  }

  getStaleLocks(ttlMs = 300_000): Array<{ file_path: string; worker_id: string; locked_at: number }> {
    const cutoff = Date.now() - ttlMs;
    return this.db.prepare('SELECT * FROM quality_file_locks WHERE locked_at < ?').all(cutoff) as FileLockRow[];
  }

  clearStaleLocks(ttlMs = 300_000): number {
    const cutoff = Date.now() - ttlMs;
    return this.db.prepare('DELETE FROM quality_file_locks WHERE locked_at < ?').run(cutoff).changes;
  }

  clearQualityQueue(): number {
    const removed = this.db.prepare('DELETE FROM quality_queue').run().changes;
    this.db.prepare('DELETE FROM quality_attempt_log').run();
    this.db.prepare('DELETE FROM quality_trend').run();
    return removed;
  }
}
