import * as path from 'path';
import { DependencyGraph } from '../graph/dependency-graph';
import { SqliteCache } from '../cache/sqlite-cache';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { FileAnalysis, Config, WSMessage } from '../types';
import { walkFiles, shouldExcludeFile } from './viz-helpers';

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

export async function scan(deps: ScannerDeps): Promise<void> {
  if (deps.getScanning()) return;
  deps.setScanning(true);

  const registeredPaths = deps.cache.getAllRepositories(true).map(r => r.path);
  const roots = new Set<string>([deps.workDir, ...deps.cache.getRepos(), ...registeredPaths]);
  const cachedPaths = new Set<string>(deps.cache.getAll().map(a => a.path));

  const seen = new Set<string>();
  const toScan: Array<{ filePath: string; root: string }> = [];
  for (const root of roots) {
    for (const filePath of walkFiles(root)) {
      if (!seen.has(filePath) && deps.analyzer.isSupportedFile(filePath) && !cachedPaths.has(filePath)) {
        const ext = path.extname(filePath);
        if (shouldExcludeFile(filePath, ext, deps.config.scanExcludePatterns)) continue;
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
    await Promise.all(
      batch.map(async ({ filePath, root }) => {
        try {
          const analysis = await deps.analyzer.analyze(filePath);
          if (!analysis) return;
          analysis.repoRoot = root;
          deps.cache.save(analysis);
          deps.graphFor(root).upsert(analysis);
          analyzed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[gate-keeper] Scan error for ${filePath}: ${msg}`);
          deps.appendScanLog(`Scan error for ${path.basename(filePath)}: ${msg}`, 'error');
        }
      })
    );
    if (analyzed - lastProgress >= 50 || i + CONCURRENCY >= toScan.length) {
      deps.broadcast({ type: 'scan_progress', scanTotal: toScan.length, scanAnalyzed: analyzed } satisfies WSMessage);
      deps.appendScanLog(`Scan progress: ${analyzed}/${toScan.length}`, 'info');
      lastProgress = analyzed;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  const completionRoots = new Set(toScan.map(s => s.root));
  for (const root of completionRoots) {
    deps.broadcast({ type: 'init', data: deps.graphFor(root).toGraphData() } satisfies WSMessage, root);
  }
  deps.broadcast({ type: 'scan_complete', scanTotal: toScan.length, scanAnalyzed: analyzed } satisfies WSMessage);
  console.error(`[gate-keeper] Scan complete: ${analyzed}/${toScan.length}`);
  deps.appendScanLog(`Scan complete: ${analyzed}/${toScan.length}`, 'info');
  deps.setScanning(false);
}

export async function scanRepo(deps: ScannerDeps, repoRoot: string, force = false): Promise<void> {
  if (deps.getScanning()) return;
  deps.setScanning(true);

  const cachedPaths = force ? new Set<string>() : new Set(deps.cache.getAll(repoRoot).map(a => a.path));
  const toScan: string[] = [];
  for (const filePath of walkFiles(repoRoot)) {
    if (deps.analyzer.isSupportedFile(filePath) && !cachedPaths.has(filePath)) {
      const ext = path.extname(filePath);
      if (shouldExcludeFile(filePath, ext, deps.config.scanExcludePatterns)) continue;
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
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          const analysis = await deps.analyzer.analyze(filePath);
          if (!analysis) return;
          analysis.repoRoot = repoRoot;
          deps.cache.save(analysis);
          deps.graphFor(repoRoot).upsert(analysis);
          analyzed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[gate-keeper] Scan error for ${filePath}: ${msg}`);
          deps.appendScanLog(`Scan error for ${path.basename(filePath)}: ${msg}`, 'error');
        }
      })
    );
    if (analyzed - lastProgress >= 50 || i + CONCURRENCY >= toScan.length) {
      deps.broadcast({ type: 'scan_progress', scanTotal: toScan.length, scanAnalyzed: analyzed } satisfies WSMessage);
      deps.appendScanLog(`Repo scan progress: ${analyzed}/${toScan.length}`, 'info');
      lastProgress = analyzed;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  deps.broadcast({ type: 'init', data: deps.graphFor(repoRoot).toGraphData() } satisfies WSMessage, repoRoot);
  deps.broadcast({ type: 'scan_complete', scanTotal: toScan.length, scanAnalyzed: analyzed } satisfies WSMessage);
  console.error(`[gate-keeper] Repo scan complete: ${analyzed}/${toScan.length} for ${path.basename(repoRoot)}`);
  deps.appendScanLog(`Repo scan complete: ${analyzed}/${toScan.length} for ${path.basename(repoRoot)}`, 'info');
  deps.setScanning(false);
}
