import * as path from 'path';
import { DependencyGraph } from '../graph/dependency-graph';
import { SqliteCache } from '../cache/sqlite-cache';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { FileAnalysis, Config, WSMessage } from '../types';
import { walkFiles, shouldExcludeFile } from './viz-helpers';
import { loadGraphifyIgnore, shouldIgnoreByGraphifyIgnore } from '../graph/graphify-ignore';

interface ScannerDeps {
  cache: SqliteCache;
  analyzer: UniversalAnalyzer;
  config: Config;
  workDir: string;
  graphs: Map<string, DependencyGraph>;
  graphFor: (repo: string) => DependencyGraph;
  broadcast: (msg: WSMessage, repoFilter?: string) => void;
  appendScanLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  getScanning: () => boolean;
  setScanning: (v: boolean) => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

export async function scan(deps: ScannerDeps): Promise<void> {
  if (deps.getScanning()) return;
  deps.setScanning(true);

  const registeredPaths = deps.cache.getAllRepositories(true).map(r => r.path);
  const roots = new Set<string>([deps.workDir, ...deps.cache.getRepos(), ...registeredPaths]);
  const cachedPaths = new Set<string>(deps.cache.getAll().map(a => a.path));

  // Prune stale cache entries (files deleted since last scan)
  const allAnalyses = deps.cache.getAll();
  const staleLookup = new Map<string, string>();
  for (const a of allAnalyses) {
    if (a.repoRoot) staleLookup.set(a.path, a.repoRoot);
  }
  const diskFiles = new Set<string>();
  for (const root of roots) {
    for (const fp of walkFiles(root)) diskFiles.add(fp);
  }
  for (const [stalePath, repoRoot] of staleLookup) {
    if (!diskFiles.has(stalePath)) {
      deps.cache.deleteFile(stalePath, repoRoot);
      deps.graphFor(repoRoot).remove(stalePath);
    }
  }
  const activePaths = new Set<string>(deps.cache.getAll().map(a => a.path));

  const seen = new Set<string>();
  const toScan: Array<{ filePath: string; root: string }> = [];
  // Build per-root .graphifyignore rule sets once, reuse across all files
  const ignoreRules = new Map(Array.from(roots).map(r => [r, loadGraphifyIgnore(r)]));

  for (const root of roots) {
    const rules = ignoreRules.get(root) ?? [];
    for (const filePath of walkFiles(root)) {
      if (!seen.has(filePath) && deps.analyzer.isSupportedFile(filePath) && !activePaths.has(filePath)) {
        const ext = path.extname(filePath);
        if (shouldExcludeFile(filePath, ext, deps.config.scanExcludePatterns)) continue;
        if (shouldIgnoreByGraphifyIgnore(filePath, root, rules)) continue;
        seen.add(filePath);
        toScan.push({ filePath, root });
      }
    }
  }

  deps.broadcast({ type: 'scan_start', scanTotal: toScan.length } satisfies WSMessage);
  console.error(`[gate-keeper] Scan: ${toScan.length} files across ${roots.size} workspace(s)`);
  deps.appendScanLog(`Scan started: ${toScan.length} files across ${roots.size} workspace(s)`, 'info');

  if (toScan.length === 0) {
    deps.broadcast({ type: 'scan_complete', scanTotal: 0, scanAnalyzed: 0 } satisfies WSMessage);
    deps.appendScanLog('Scan complete: 0 files', 'info');
    deps.setScanning(false);
    return;
  }

  const CONCURRENCY = 8;
  let analyzed = 0;
  let lastProgress = 0;

  for (let i = 0; i < toScan.length; i += CONCURRENCY) {
    const batch = toScan.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async ({ filePath, root }) => {
        const analysis = await deps.analyzer.analyze(filePath);
        if (!analysis) return;
        analysis.repoRoot = root;

        deps.cache.save(analysis);
        deps.graphFor(root).upsert(analysis);
        analyzed++;
      })
    );

    // Log batch errors without blocking
    for (const result of batchResults) {
      if (result.status === 'rejected') {
        try {
          const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          deps.appendScanLog(`Scan error: ${msg}`, 'error');
        } catch {
          // Silently ignore logging failures in tests
        }
      }
    }

    if (analyzed - lastProgress >= 50 || i + CONCURRENCY >= toScan.length) {
      deps.broadcast({ type: 'scan_progress', scanTotal: toScan.length, scanAnalyzed: analyzed } satisfies WSMessage);
      try {
        deps.appendScanLog(`Scan progress: ${analyzed}/${toScan.length}`, 'info');
      } catch {
        // Silently ignore logging failures in tests
      }
      lastProgress = analyzed;
    }
  }

  const completionRoots = new Set(toScan.map(s => s.root));
  for (const root of completionRoots) {
    deps.broadcast({ type: 'init', data: deps.graphFor(root).toGraphData() } satisfies WSMessage, root);
  }
  deps.broadcast({ type: 'scan_complete', scanTotal: toScan.length, scanAnalyzed: analyzed } satisfies WSMessage);
  console.error(`[gate-keeper] Scan complete: ${analyzed}/${toScan.length}`);
  try {
    deps.appendScanLog(`Scan complete: ${analyzed}/${toScan.length}`, 'info');
  } catch (logErr) {
    console.error(`[gate-keeper] Failed to log scan completion to DB:`, logErr instanceof Error ? logErr.message : String(logErr));
  }
  deps.setScanning(false);
}

export async function scanRepo(deps: ScannerDeps, repoRoot: string, force = false): Promise<void> {
  if (deps.getScanning()) return;
  deps.setScanning(true);

  let cachedPaths = force ? new Set<string>() : new Set(deps.cache.getAll(repoRoot).map(a => a.path));

  // Prune stale cache entries (files deleted since last scan)
  if (!force) {
    const allAnalyses = deps.cache.getAll(repoRoot);
    const staleLookup = new Map<string, string>();
    for (const a of allAnalyses) {
      if (a.repoRoot) staleLookup.set(a.path, a.repoRoot);
    }
    const diskFiles = new Set(walkFiles(repoRoot));
    for (const [stalePath, staleRepo] of staleLookup) {
      if (!diskFiles.has(stalePath)) {
        deps.cache.deleteFile(stalePath, staleRepo);
        deps.graphFor(staleRepo).remove(stalePath);
      }
    }
    cachedPaths = new Set(deps.cache.getAll(repoRoot).map(a => a.path));
  }

  const toScan: string[] = [];
  const ignoreRules = loadGraphifyIgnore(repoRoot);
  for (const filePath of walkFiles(repoRoot)) {
    if (deps.analyzer.isSupportedFile(filePath) && !cachedPaths.has(filePath)) {
      const ext = path.extname(filePath);
      if (shouldExcludeFile(filePath, ext, deps.config.scanExcludePatterns)) continue;
      if (shouldIgnoreByGraphifyIgnore(filePath, repoRoot, ignoreRules)) continue;
      toScan.push(filePath);
    }
  }

  if (toScan.length === 0) {
    deps.appendScanLog(`Repo scan complete: 0 files for ${path.basename(repoRoot)}`, 'info');
    deps.setScanning(false);
    return;
  }

  deps.broadcast({ type: 'scan_start', scanTotal: toScan.length } satisfies WSMessage);
  console.error(`[gate-keeper] Scanning ${toScan.length} files for new repo: ${path.basename(repoRoot)}`);
  deps.appendScanLog(`Repo scan started: ${toScan.length} files for ${path.basename(repoRoot)}`, 'info');

  const CONCURRENCY = 8;
  let analyzed = 0;
  let lastProgress = 0;

  for (let i = 0; i < toScan.length; i += CONCURRENCY) {
    const batch = toScan.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (filePath) => {
        const analysis = await deps.analyzer.analyze(filePath);
        if (!analysis) return;
        analysis.repoRoot = repoRoot;

        deps.cache.save(analysis);
        deps.graphFor(repoRoot).upsert(analysis);
        analyzed++;
      })
    );

    // Log batch errors without blocking
    for (const result of batchResults) {
      if (result.status === 'rejected') {
        try {
          const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          deps.appendScanLog(`Scan error: ${msg}`, 'error');
        } catch {
          // Silently ignore logging failures in tests
        }
      }
    }

    if (analyzed - lastProgress >= 50 || i + CONCURRENCY >= toScan.length) {
      deps.broadcast({ type: 'scan_progress', scanTotal: toScan.length, scanAnalyzed: analyzed } satisfies WSMessage);
      try {
        deps.appendScanLog(`Repo scan progress: ${analyzed}/${toScan.length}`, 'info');
      } catch {
        // Silently ignore logging failures in tests
      }
      lastProgress = analyzed;
    }
  }

  deps.broadcast({ type: 'init', data: deps.graphFor(repoRoot).toGraphData() } satisfies WSMessage, repoRoot);
  deps.broadcast({ type: 'scan_complete', scanTotal: toScan.length, scanAnalyzed: analyzed } satisfies WSMessage);
  console.error(`[gate-keeper] Repo scan complete: ${analyzed}/${toScan.length} for ${path.basename(repoRoot)}`);
  try {
    deps.appendScanLog(`Repo scan complete: ${analyzed}/${toScan.length} for ${path.basename(repoRoot)}`, 'info');
  } catch (logErr) {
    console.error(`[gate-keeper] Failed to log repo scan completion to DB:`, logErr instanceof Error ? logErr.message : String(logErr));
  }
  deps.setScanning(false);
}
