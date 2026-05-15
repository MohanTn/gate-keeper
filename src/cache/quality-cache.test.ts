import Database from 'better-sqlite3';
import { QualityCache } from './quality-cache';

// ── Shared in-memory schema ───────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE quality_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL,
    file_path TEXT NOT NULL,
    current_rating REAL NOT NULL DEFAULT 0,
    target_rating REAL NOT NULL DEFAULT 7,
    priority_score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    worker_id TEXT,
    locked_at INTEGER,
    error_message TEXT,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(repo, file_path)
  );

  CREATE TABLE quality_attempt_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    rating_before REAL NOT NULL,
    rating_after REAL,
    violations_fixed INTEGER NOT NULL DEFAULT 0,
    violations_remaining INTEGER NOT NULL DEFAULT 0,
    fix_summary TEXT,
    error_message TEXT,
    duration_ms INTEGER,
    worker_output TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE quality_trend (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL,
    overall_rating REAL NOT NULL,
    files_total INTEGER NOT NULL,
    files_passed INTEGER NOT NULL,
    files_failed INTEGER NOT NULL,
    files_pending INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL
  );

  CREATE TABLE quality_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reason TEXT NOT NULL,
    queue_snapshot TEXT NOT NULL,
    files_fixed INTEGER NOT NULL,
    overall_rating REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE quality_file_locks (
    file_path TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL,
    locked_at INTEGER NOT NULL
  );
`;

function createDb(): { db: Database.Database; cache: QualityCache } {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return { db, cache: new QualityCache(db) };
}

const REPO = '/home/user/project';
const FILE_A = '/home/user/project/src/a.ts';
const FILE_B = '/home/user/project/src/b.ts';

// ── enqueueFile ───────────────────────────────────────────────────────────────

describe('enqueueFile', () => {
  it('inserts a new file into the queue', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    const rows = cache.getQueue();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.file_path).toBe(FILE_A);
    expect(rows[0]!.current_rating).toBe(5.0);
    expect(rows[0]!.target_rating).toBe(8.0);
    expect(rows[0]!.priority_score).toBe(0.9);
    expect(rows[0]!.status).toBe('pending');
  });

  it('updates existing entry without resetting status when re-enqueued', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.updateQueueItem(1, { status: 'in_progress' });
    cache.enqueueFile(REPO, FILE_A, 6.0, 8.0, 0.8);
    const rows = cache.getQueue();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.current_rating).toBe(6.0);
    expect(rows[0]!.status).toBe('in_progress'); // status preserved for non-pending
  });

  it('enqueues multiple files', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.enqueueFile(REPO, FILE_B, 4.0, 7.0, 0.5);
    expect(cache.getQueue()).toHaveLength(2);
  });
});

// ── getQueue ──────────────────────────────────────────────────────────────────

describe('getQueue', () => {
  it('returns all items when no filters', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.enqueueFile(REPO, FILE_B, 4.0, 8.0, 0.5);
    expect(cache.getQueue()).toHaveLength(2);
  });

  it('filters by status', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.enqueueFile(REPO, FILE_B, 4.0, 8.0, 0.5);
    cache.updateQueueItem(2, { status: 'completed' });
    const pending = cache.getQueue('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.file_path).toBe(FILE_A);
  });

  it('filters by repo', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.enqueueFile('/other/repo', '/other/repo/src/x.ts', 6.0, 8.0, 0.3);
    const rows = cache.getQueue(undefined, REPO);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.repo).toBe(REPO);
  });

  it('returns results ordered by priority_score DESC', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.3);
    cache.enqueueFile(REPO, FILE_B, 4.0, 8.0, 0.9);
    const rows = cache.getQueue();
    expect(rows[0]!.priority_score).toBe(0.9);
    expect(rows[1]!.priority_score).toBe(0.3);
  });

  it('returns empty array when queue is empty', () => {
    const { cache } = createDb();
    expect(cache.getQueue()).toEqual([]);
  });
});

// ── getQueueItem ──────────────────────────────────────────────────────────────

describe('getQueueItem', () => {
  it('returns the item for a valid id', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    const item = cache.getQueueItem(1);
    expect(item).toBeDefined();
    expect(item!.file_path).toBe(FILE_A);
  });

  it('returns undefined for a non-existent id', () => {
    const { cache } = createDb();
    expect(cache.getQueueItem(999)).toBeUndefined();
  });
});

// ── updateQueueItem ───────────────────────────────────────────────────────────

describe('updateQueueItem', () => {
  it('updates status field', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.updateQueueItem(1, { status: 'completed' });
    expect(cache.getQueueItem(1)!.status).toBe('completed');
  });

  it('updates multiple fields at once', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.updateQueueItem(1, { status: 'failed', error_message: 'timeout', attempts: 3 });
    const item = cache.getQueueItem(1)!;
    expect(item.status).toBe('failed');
    expect(item.error_message).toBe('timeout');
    expect(item.attempts).toBe(3);
  });

  it('does nothing when updates is empty', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    expect(() => cache.updateQueueItem(1, {})).not.toThrow();
    expect(cache.getQueueItem(1)!.status).toBe('pending');
  });
});

// ── logAttempt + getAttemptLog ────────────────────────────────────────────────

describe('logAttempt / getAttemptLog', () => {
  it('logs an attempt and retrieves it', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.logAttempt({
      queueId: 1, attempt: 1, ratingBefore: 5.0, ratingAfter: 6.5,
      violationsFixed: 3, violationsRemaining: 2,
      fixSummary: 'fixed some', durationMs: 12000, workerOutput: 'ok',
    });
    const logs = cache.getAttemptLog(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.rating_before).toBe(5.0);
    expect(logs[0]!.rating_after).toBe(6.5);
    expect(logs[0]!.violations_fixed).toBe(3);
    expect(logs[0]!.violations_remaining).toBe(2);
    expect(logs[0]!.fix_summary).toBe('fixed some');
    expect(logs[0]!.duration_ms).toBe(12000);
  });

  it('logs with only required fields (defaults applied)', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.logAttempt({ queueId: 1, attempt: 1, ratingBefore: 5.0 });
    const logs = cache.getAttemptLog(1);
    expect(logs[0]!.violations_fixed).toBe(0);
    expect(logs[0]!.violations_remaining).toBe(0);
    expect(logs[0]!.rating_after).toBeNull();
  });

  it('returns multiple logs ordered by attempt ASC', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.logAttempt({ queueId: 1, attempt: 2, ratingBefore: 6.0 });
    cache.logAttempt({ queueId: 1, attempt: 1, ratingBefore: 5.0 });
    const logs = cache.getAttemptLog(1);
    expect(logs[0]!.attempt).toBe(1);
    expect(logs[1]!.attempt).toBe(2);
  });

  it('returns empty array when no logs for queue item', () => {
    const { cache } = createDb();
    expect(cache.getAttemptLog(999)).toEqual([]);
  });
});

// ── getAttemptLogWithOutput ───────────────────────────────────────────────────

describe('getAttemptLogWithOutput', () => {
  it('includes worker_output field', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.logAttempt({ queueId: 1, attempt: 1, ratingBefore: 5.0, workerOutput: 'worker said hello' });
    const logs = cache.getAttemptLogWithOutput(1);
    expect(logs[0]!.worker_output).toBe('worker said hello');
  });
});

// ── recordTrend + getTrends ───────────────────────────────────────────────────

describe('recordTrend / getTrends', () => {
  it('records and retrieves a trend entry', () => {
    const { cache } = createDb();
    cache.recordTrend(REPO, 7.5, 100, 80, 15, 5);
    const trends = cache.getTrends(REPO);
    expect(trends).toHaveLength(1);
    expect(trends[0]!.overall_rating).toBe(7.5);
    expect(trends[0]!.files_total).toBe(100);
    expect(trends[0]!.files_passed).toBe(80);
    expect(trends[0]!.files_failed).toBe(15);
    expect(trends[0]!.files_pending).toBe(5);
    expect(trends[0]!.repo).toBe(REPO);
  });

  it('filters trends by repo', () => {
    const { cache } = createDb();
    cache.recordTrend(REPO, 7.0, 50, 40, 8, 2);
    cache.recordTrend('/other/repo', 6.0, 30, 20, 8, 2);
    expect(cache.getTrends(REPO)).toHaveLength(1);
    expect(cache.getTrends('/other/repo')).toHaveLength(1);
  });

  it('returns all repos when no filter', () => {
    const { cache } = createDb();
    cache.recordTrend(REPO, 7.0, 50, 40, 8, 2);
    cache.recordTrend('/other', 6.0, 30, 20, 8, 2);
    expect(cache.getTrends()).toHaveLength(2);
  });

  it('respects limit parameter', () => {
    const { cache } = createDb();
    for (let i = 0; i < 10; i++) cache.recordTrend(REPO, 7.0 + i * 0.1, 100, 80, 15, 5);
    expect(cache.getTrends(REPO, 5)).toHaveLength(5);
  });

  it('orders by recorded_at ASC', () => {
    const { cache } = createDb();
    cache.recordTrend(REPO, 6.0, 100, 60, 30, 10);
    cache.recordTrend(REPO, 8.0, 100, 80, 15, 5);
    const trends = cache.getTrends(REPO);
    expect(trends[0]!.overall_rating).toBe(6.0);
    expect(trends[1]!.overall_rating).toBe(8.0);
  });
});

// ── saveCheckpoint + getLatestCheckpoint ─────────────────────────────────────

describe('saveCheckpoint / getLatestCheckpoint', () => {
  it('returns null when no checkpoint exists', () => {
    const { cache } = createDb();
    expect(cache.getLatestCheckpoint()).toBeNull();
  });

  it('saves and retrieves a checkpoint', () => {
    const { cache } = createDb();
    cache.saveCheckpoint('after-scan', '{"items":[]}', 5, 7.5);
    const cp = cache.getLatestCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp!.reason).toBe('after-scan');
    expect(cp!.queue_snapshot).toBe('{"items":[]}');
    expect(cp!.files_fixed).toBe(5);
    expect(cp!.overall_rating).toBe(7.5);
  });

  it('returns the most recent checkpoint', () => {
    const { cache } = createDb();
    const t1 = Date.now();
    const t2 = t1 + 1000;
    jest.spyOn(Date, 'now').mockReturnValueOnce(t1).mockReturnValueOnce(t2);
    cache.saveCheckpoint('first', '{}', 0, 5.0);
    cache.saveCheckpoint('second', '{}', 3, 7.0);
    expect(cache.getLatestCheckpoint()!.reason).toBe('second');
    jest.restoreAllMocks();
  });
});

// ── acquireLock / releaseLock ─────────────────────────────────────────────────

describe('acquireLock / releaseLock', () => {
  it('acquires lock on a free file', () => {
    const { cache } = createDb();
    expect(cache.acquireLock(FILE_A, 'worker-1')).toBe(true);
  });

  it('cannot acquire lock on a locked file', () => {
    const { cache } = createDb();
    cache.acquireLock(FILE_A, 'worker-1');
    expect(cache.acquireLock(FILE_A, 'worker-2')).toBe(false);
  });

  it('expired lock can be re-acquired', () => {
    const { db, cache } = createDb();
    // Insert a lock with a very old locked_at (already expired)
    db.prepare('INSERT INTO quality_file_locks (file_path, worker_id, locked_at) VALUES (?, ?, ?)').run(FILE_A, 'old-worker', Date.now() - 400_000);
    expect(cache.acquireLock(FILE_A, 'worker-new', 300_000)).toBe(true);
  });

  it('releases a lock', () => {
    const { cache } = createDb();
    cache.acquireLock(FILE_A, 'worker-1');
    cache.releaseLock(FILE_A, 'worker-1');
    expect(cache.acquireLock(FILE_A, 'worker-2')).toBe(true);
  });

  it('release does not affect other workers locks', () => {
    const { cache } = createDb();
    cache.acquireLock(FILE_A, 'worker-1');
    cache.releaseLock(FILE_A, 'wrong-worker'); // wrong worker id — should not release
    expect(cache.acquireLock(FILE_A, 'worker-2')).toBe(false);
  });
});

// ── getQueueStats ─────────────────────────────────────────────────────────────

describe('getQueueStats', () => {
  it('returns all zeros when queue is empty', () => {
    const { cache } = createDb();
    const stats = cache.getQueueStats();
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('counts by status correctly', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.enqueueFile(REPO, FILE_B, 4.0, 8.0, 0.5);
    cache.updateQueueItem(1, { status: 'completed' });
    cache.updateQueueItem(2, { status: 'failed' });

    const stats = cache.getQueueStats();
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it('includes in_progress in total', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.updateQueueItem(1, { status: 'in_progress' });
    const stats = cache.getQueueStats();
    expect(stats.total).toBe(1);
    expect(stats.in_progress).toBe(1);
  });
});

// ── getStaleLocks / clearStaleLocks ──────────────────────────────────────────

describe('getStaleLocks / clearStaleLocks', () => {
  it('returns empty array when no locks exist', () => {
    const { cache } = createDb();
    expect(cache.getStaleLocks()).toEqual([]);
  });

  it('returns stale locks that exceed TTL', () => {
    const { db, cache } = createDb();
    db.prepare('INSERT INTO quality_file_locks VALUES (?, ?, ?)').run(FILE_A, 'w1', Date.now() - 400_000);
    const stale = cache.getStaleLocks(300_000);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.file_path).toBe(FILE_A);
  });

  it('does not return fresh locks as stale', () => {
    const { cache } = createDb();
    cache.acquireLock(FILE_A, 'w1');
    expect(cache.getStaleLocks(300_000)).toHaveLength(0);
  });

  it('clearStaleLocks removes only expired locks', () => {
    const { db, cache } = createDb();
    db.prepare('INSERT INTO quality_file_locks VALUES (?, ?, ?)').run(FILE_A, 'w1', Date.now() - 400_000);
    cache.acquireLock(FILE_B, 'w2'); // fresh lock
    const removed = cache.clearStaleLocks(300_000);
    expect(removed).toBe(1);
    expect(cache.acquireLock(FILE_A, 'w3')).toBe(true); // stale was cleared
    expect(cache.acquireLock(FILE_B, 'w3')).toBe(false); // fresh still locked
  });

  it('clearStaleLocks returns 0 when no stale locks', () => {
    const { cache } = createDb();
    expect(cache.clearStaleLocks()).toBe(0);
  });
});

// ── clearQualityQueue ─────────────────────────────────────────────────────────

describe('clearQualityQueue', () => {
  it('removes all queue items and logs', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.logAttempt({ queueId: 1, attempt: 1, ratingBefore: 5.0 });
    cache.recordTrend(REPO, 7.0, 10, 8, 2, 0);

    const removed = cache.clearQualityQueue();
    expect(removed).toBe(1);
    expect(cache.getQueue()).toHaveLength(0);
    expect(cache.getAttemptLog(1)).toHaveLength(0);
    expect(cache.getTrends()).toHaveLength(0);
  });

  it('returns 0 when queue was already empty', () => {
    const { cache } = createDb();
    expect(cache.clearQualityQueue()).toBe(0);
  });

  it('returns count of deleted queue items', () => {
    const { cache } = createDb();
    cache.enqueueFile(REPO, FILE_A, 5.0, 8.0, 0.9);
    cache.enqueueFile(REPO, FILE_B, 4.0, 8.0, 0.5);
    expect(cache.clearQualityQueue()).toBe(2);
  });
});
