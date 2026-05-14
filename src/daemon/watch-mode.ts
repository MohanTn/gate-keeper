/**
 * Watch mode — polls source files for mtime changes and triggers re-analysis.
 *
 * Uses fs.watchFile (stat-polling) rather than fs.watch (inotify) because inotify
 * silently drops events on WSL DrvFs and NFS mounts. Same approach as the LCOV
 * watcher in daemon.ts.
 *
 * Usage:
 *   const watcher = new WatchMode();
 *   watcher.start('/repo', (changed) => reAnalyze(changed), 5000);
 *   // later:
 *   watcher.stop();
 */

import * as fs from 'fs';
import * as path from 'path';
import { walkFiles } from '../viz/viz-helpers';
import { loadGraphifyIgnore, shouldIgnoreByGraphifyIgnore } from '../graph/graphify-ignore';

const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cs']);

export interface WatchStats {
  watchedFiles: number;
  changesDetected: number;
  lastPollAt: number | null;
}

export class WatchMode {
  private mtimeCache = new Map<string, number>();
  private pollTimer: NodeJS.Timeout | null = null;
  private stats: WatchStats = { watchedFiles: 0, changesDetected: 0, lastPollAt: null };
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanged = new Set<string>();

  /**
   * Start watching `repoRoot` for source file changes.
   *
   * @param repoRoot      Absolute repo path to watch.
   * @param onChanged     Called with list of changed absolute file paths (debounced).
   * @param intervalMs    How often to poll for changes (default 5 s).
   * @param debounceMs    How long to wait before flushing a batch of changes (default 1 s).
   */
  start(
    repoRoot: string,
    onChanged: (changedFiles: string[]) => void,
    intervalMs = 5_000,
    debounceMs = 1_000,
  ): void {
    this.snapshot(repoRoot);

    this.pollTimer = setInterval(() => {
      const changed = this.detectChanges(repoRoot);
      this.stats.lastPollAt = Date.now();

      if (changed.length === 0) return;

      this.stats.changesDetected += changed.length;
      for (const f of changed) this.pendingChanged.add(f);

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const batch = [...this.pendingChanged];
        this.pendingChanged.clear();
        this.debounceTimer = null;
        onChanged(batch);
      }, debounceMs);
    }, intervalMs);
  }

  stop(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.mtimeCache.clear();
    this.pendingChanged.clear();
  }

  getStats(): WatchStats {
    return { ...this.stats };
  }

  /** Force an immediate snapshot update (e.g. after a manual re-analysis). */
  refresh(repoRoot: string): void {
    this.snapshot(repoRoot);
  }

  // ── Internal ─────────────────────────────────────────────

  private snapshot(repoRoot: string): void {
    const ignoreRules = loadGraphifyIgnore(repoRoot);
    let count = 0;
    for (const filePath of walkFiles(repoRoot)) {
      if (!SUPPORTED_EXTS.has(path.extname(filePath))) continue;
      if (shouldIgnoreByGraphifyIgnore(filePath, repoRoot, ignoreRules)) continue;
      try {
        const { mtimeMs } = fs.statSync(filePath);
        this.mtimeCache.set(filePath, mtimeMs);
        count++;
      } catch {
        // file disappeared between walk and stat — skip
      }
    }
    this.stats.watchedFiles = count;
  }

  private detectChanges(repoRoot: string): string[] {
    const ignoreRules = loadGraphifyIgnore(repoRoot);
    const changed: string[] = [];
    const seen = new Set<string>();

    for (const filePath of walkFiles(repoRoot)) {
      if (!SUPPORTED_EXTS.has(path.extname(filePath))) continue;
      if (shouldIgnoreByGraphifyIgnore(filePath, repoRoot, ignoreRules)) continue;
      seen.add(filePath);
      try {
        const { mtimeMs } = fs.statSync(filePath);
        if (this.mtimeCache.get(filePath) !== mtimeMs) {
          this.mtimeCache.set(filePath, mtimeMs);
          changed.push(filePath);
        }
      } catch {
        // file disappeared — treat as changed (deletion)
        if (this.mtimeCache.has(filePath)) {
          this.mtimeCache.delete(filePath);
          changed.push(filePath);
        }
      }
    }

    // New files not in cache yet
    for (const filePath of seen) {
      if (!this.mtimeCache.has(filePath)) changed.push(filePath);
    }

    this.stats.watchedFiles = seen.size;
    return changed;
  }
}
