import { SqliteCache } from '../cache/sqlite-cache';

const STALE_LOCK_MS = 300_000; // 5 minutes

export class FileLockManager {
  private memoryLocks = new Map<string, string>(); // filePath -> workerId
  private cache: SqliteCache;

  constructor(cache: SqliteCache) {
    this.cache = cache;
  }

  acquire(filePath: string, workerId: string): boolean {
    if (this.memoryLocks.has(filePath)) return false;
    if (!this.cache.quality.acquireLock(filePath, workerId, STALE_LOCK_MS)) return false;
    this.memoryLocks.set(filePath, workerId);
    return true;
  }

  release(filePath: string, workerId: string): void {
    this.memoryLocks.delete(filePath);
    this.cache.quality.releaseLock(filePath, workerId);
  }

  isLocked(filePath: string): boolean {
    return this.memoryLocks.has(filePath);
  }

  getLockedPaths(): Set<string> {
    return new Set(this.memoryLocks.keys());
  }

  clearStale(): number {
    const stale = this.cache.quality.getStaleLocks(STALE_LOCK_MS);
    for (const lock of stale) {
      this.memoryLocks.delete(lock.file_path);
    }
    return this.cache.quality.clearStaleLocks(STALE_LOCK_MS);
  }
}
