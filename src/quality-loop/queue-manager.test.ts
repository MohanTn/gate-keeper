import { SqliteCache } from '../cache/sqlite-cache';
import { QueueManager } from './queue-manager';

function makeCache(): SqliteCache {
  return new SqliteCache(':memory:');
}

describe('QueueManager', () => {
  describe('buildQueue', () => {
    it('enqueues only files below the threshold', () => {
      const qm = new QueueManager(makeCache());
      const ratings = new Map<string, { rating: number; repo: string }>([
        ['/r/a.ts', { rating: 5, repo: '/r' }],
        ['/r/b.ts', { rating: 8, repo: '/r' }],
        ['/r/c.ts', { rating: 6.9, repo: '/r' }],
      ]);

      const enqueued = qm.buildQueue({ repos: ['/r'], threshold: 7, fileRatings: ratings });

      expect(enqueued).toBe(2);
      const all = qm.getAllItems();
      expect(all.map(i => i.filePath).sort()).toEqual(['/r/a.ts', '/r/c.ts']);
    });

    it('orders worst-rated first via priority score', () => {
      const qm = new QueueManager(makeCache());
      const ratings = new Map<string, { rating: number; repo: string }>([
        ['/r/mild.ts', { rating: 6, repo: '/r' }],
        ['/r/bad.ts', { rating: 2, repo: '/r' }],
        ['/r/middling.ts', { rating: 4, repo: '/r' }],
      ]);

      qm.buildQueue({ repos: ['/r'], threshold: 7, fileRatings: ratings });

      const picked = qm.pickNext(3, new Set());
      expect(picked.map(p => p.filePath)).toEqual([
        '/r/bad.ts',
        '/r/middling.ts',
        '/r/mild.ts',
      ]);
    });

    it('uses violation severity as a tiebreaker when ratings are equal', () => {
      const qm = new QueueManager(makeCache());
      const ratings = new Map<string, { rating: number; repo: string }>([
        ['/r/x.ts', { rating: 5, repo: '/r' }],
        ['/r/y.ts', { rating: 5, repo: '/r' }],
      ]);
      const violations = new Map([
        ['/r/x.ts', { errors: 0, warnings: 1, info: 0 }],
        ['/r/y.ts', { errors: 2, warnings: 0, info: 0 }],
      ]);

      qm.buildQueue({
        repos: ['/r'],
        threshold: 7,
        fileRatings: ratings,
        violationCounts: violations,
      });

      const picked = qm.pickNext(2, new Set());
      expect(picked[0].filePath).toBe('/r/y.ts');
    });
  });

  describe('pickNext', () => {
    it('skips excluded paths', () => {
      const qm = new QueueManager(makeCache());
      qm.buildQueue({
        repos: ['/r'],
        threshold: 7,
        fileRatings: new Map([
          ['/r/a.ts', { rating: 3, repo: '/r' }],
          ['/r/b.ts', { rating: 4, repo: '/r' }],
        ]),
      });

      const picked = qm.pickNext(5, new Set(['/r/a.ts']));
      expect(picked.map(p => p.filePath)).toEqual(['/r/b.ts']);
    });

    it('respects the count limit', () => {
      const qm = new QueueManager(makeCache());
      qm.buildQueue({
        repos: ['/r'],
        threshold: 7,
        fileRatings: new Map([
          ['/r/a.ts', { rating: 3, repo: '/r' }],
          ['/r/b.ts', { rating: 4, repo: '/r' }],
          ['/r/c.ts', { rating: 5, repo: '/r' }],
        ]),
      });

      expect(qm.pickNext(2, new Set()).length).toBe(2);
    });
  });

  describe('lifecycle transitions', () => {
    function seed(): { qm: QueueManager; id: number } {
      const qm = new QueueManager(makeCache());
      qm.buildQueue({
        repos: ['/r'],
        threshold: 7,
        fileRatings: new Map([['/r/a.ts', { rating: 3, repo: '/r' }]]),
      });
      const item = qm.pickNext(1, new Set())[0];
      return { qm, id: item.id };
    }

    it('markInProgress sets worker and lock timestamp', () => {
      const { qm, id } = seed();
      qm.markInProgress(id, 'worker-1');
      const item = qm.getItem(id)!;
      expect(item.status).toBe('in_progress');
      expect(item.workerId).toBe('worker-1');
      expect(item.lockedAt).not.toBeNull();
    });

    it('markCompleted records new rating and clears worker', () => {
      const { qm, id } = seed();
      qm.markInProgress(id, 'w');
      qm.markCompleted(id, 8.5);
      const item = qm.getItem(id)!;
      expect(item.status).toBe('completed');
      expect(item.currentRating).toBe(8.5);
      expect(item.workerId).toBeNull();
      expect(item.completedAt).not.toBeNull();
    });

    it('markFailed retries until max_attempts, then skips', () => {
      const { qm, id } = seed();
      qm.markFailed(id, 'first error');
      expect(qm.getItem(id)!.status).toBe('pending');
      expect(qm.getItem(id)!.attempts).toBe(1);

      qm.markFailed(id, 'second error');
      expect(qm.getItem(id)!.status).toBe('pending');

      qm.markFailed(id, 'third error');
      expect(qm.getItem(id)!.status).toBe('skipped');
      expect(qm.getItem(id)!.errorMessage).toBe('third error');
    });

    it('markSkipped sets skipped status directly', () => {
      const { qm, id } = seed();
      qm.markSkipped(id, 'unreachable');
      const item = qm.getItem(id)!;
      expect(item.status).toBe('skipped');
      expect(item.errorMessage).toBe('unreachable');
    });
  });

  describe('resetFailed', () => {
    it('returns failed/skipped items to pending and resets attempts', () => {
      const qm = new QueueManager(makeCache());
      qm.buildQueue({
        repos: ['/r'],
        threshold: 7,
        fileRatings: new Map([['/r/a.ts', { rating: 3, repo: '/r' }]]),
      });
      const id = qm.pickNext(1, new Set())[0].id;
      qm.markSkipped(id, 'oops');

      const reset = qm.resetFailed();

      expect(reset).toBe(1);
      const item = qm.getItem(id)!;
      expect(item.status).toBe('pending');
      expect(item.attempts).toBe(0);
      expect(item.errorMessage).toBeNull();
    });
  });

  describe('getStats', () => {
    it('summarizes queue counts using camelCase keys', () => {
      const qm = new QueueManager(makeCache());
      qm.buildQueue({
        repos: ['/r'],
        threshold: 7,
        fileRatings: new Map([
          ['/r/a.ts', { rating: 3, repo: '/r' }],
          ['/r/b.ts', { rating: 4, repo: '/r' }],
        ]),
      });
      const id = qm.pickNext(1, new Set())[0].id;
      qm.markInProgress(id, 'w');

      const stats = qm.getStats();
      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(1);
      expect(stats.inProgress).toBe(1);
    });
  });

  describe('checkpoints', () => {
    it('saveCheckpoint + restoreFromCheckpoint resumes interrupted work', () => {
      const cache = makeCache();
      const qm = new QueueManager(cache);
      qm.buildQueue({
        repos: ['/r'],
        threshold: 7,
        fileRatings: new Map([['/r/a.ts', { rating: 3, repo: '/r' }]]),
      });
      const id = qm.pickNext(1, new Set())[0].id;
      qm.markInProgress(id, 'w');
      qm.saveCheckpoint('interrupted', 0, 5.0);

      const restored = qm.restoreFromCheckpoint();

      expect(restored.length).toBe(1);
      const live = qm.getItem(id)!;
      expect(live.status).toBe('pending');
      expect(live.workerId).toBeNull();
    });

    it('returns empty array when latest checkpoint is not an interrupt', () => {
      const qm = new QueueManager(makeCache());
      qm.buildQueue({
        repos: ['/r'],
        threshold: 7,
        fileRatings: new Map([['/r/a.ts', { rating: 3, repo: '/r' }]]),
      });
      qm.saveCheckpoint('manual', 0, 5.0);

      expect(qm.restoreFromCheckpoint()).toEqual([]);
    });
  });
});
