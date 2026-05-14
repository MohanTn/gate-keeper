import express from 'express';
import * as path from 'path';
import { DependencyGraph, CycleInfo } from '../graph/dependency-graph';
import { SqliteCache } from '../cache/sqlite-cache';
import { RatingCalculator } from '../rating/rating-calculator';
import { PatternDetector } from '../analyzer/pattern-detector';
import { RefactoringAdvisor } from '../analyzer/refactoring-advisor';
import { Config, GraphData } from '../types';
import { getGitDiffStats } from './viz-helpers';
import { readArchConfig, writeArchConfig, setLayerOverride } from '../arch/arch-config-manager';

const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
const CONFIG_FILE = path.join(GK_DIR, 'config.json');

interface RouteDeps {
  graphs: Map<string, DependencyGraph>;
  cache: SqliteCache;
  config: Config;
  ratingCalc: RatingCalculator;
  patternDetector: PatternDetector;
  refactoringAdvisor: RefactoringAdvisor;
  scanning: () => boolean;
  setScanning: (v: boolean) => void;
  scanFn: (force: boolean) => Promise<void>;
  scanRepoFn: (repo: string, force: boolean) => Promise<void>;
  mergedGraphData: () => GraphData;
  graphFor: (repo: string) => DependencyGraph;
  mergedOverallRating: () => number;
  appendScanLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  getLiveConfig: () => Config;
  workDir: string;
}

export function registerRoutes(app: express.Application, deps: RouteDeps): void {
  const dashboardBuild = path.join(__dirname, '../../dashboard/dist');
  app.use('/viz', express.static(dashboardBuild));
  app.get('/', (_req, res) => res.redirect('/viz'));

  app.get('/api/repos', (_req, res) => {
    const registered = deps.cache.getAllRepositories(true);
    const analyzedRoots = new Set(deps.cache.getRepos());
    const repoMap = new Map<string, { repoRoot: string; label: string; fileCount: number; sessionType: string }>();

    for (const r of registered) {
      repoMap.set(r.path, {
        repoRoot: r.path, label: r.name,
        fileCount: deps.graphs.get(r.path)?.toGraphData().nodes.length ?? 0,
        sessionType: r.sessionType
      });
    }
    for (const repo of analyzedRoots) {
      if (!repoMap.has(repo)) {
        repoMap.set(repo, {
          repoRoot: repo, label: path.basename(repo),
          fileCount: deps.graphs.get(repo)?.toGraphData().nodes.length ?? 0,
          sessionType: 'unknown'
        });
      }
    }
    res.json(Array.from(repoMap.values()));
  });

  app.get('/api/graph', (req, res) => {
    const repo = req.query['repo'] as string | undefined;
    res.json(repo ? deps.graphFor(repo).toGraphData() : deps.mergedGraphData());
  });

  app.get('/api/hotspots', (req, res) => {
    const repo = req.query['repo'] as string | undefined;
    if (repo) {
      res.json(deps.graphFor(repo).findHotspots());
    } else {
      const all: ReturnType<DependencyGraph['findHotspots']> = [];
      for (const g of deps.graphs.values()) all.push(...g.findHotspots(10));
      res.json(all.sort((a, b) => a.rating - b.rating).slice(0, 5));
    }
  });

  app.get('/api/trends', (req, res) => {
    const filePath = req.query['file'] as string;
    const repo = req.query['repo'] as string;
    if (!filePath || !repo) { res.status(400).json({ error: 'file and repo query params required' }); return; }
    res.json(deps.cache.getRatingHistory(filePath, repo));
  });

  app.get('/api/status', (req, res) => {
    const repo = req.query['repo'] as string | undefined;
    const graph = repo ? deps.graphs.get(repo) : null;
    res.json({
      running: true, port: 5378,
      overallRating: graph ? graph.overallRating() : deps.mergedOverallRating(),
      cycles: graph ? graph.detectCycles().length : 0,
      scanning: deps.scanning()
    });
  });

  app.get('/api/cycles', (req, res) => {
    const repo = req.query['repo'] as string | undefined;
    if (repo) {
      res.json(deps.graphFor(repo).detectCycles());
    } else {
      const cycles: CycleInfo[] = [];
      for (const g of deps.graphs.values()) cycles.push(...g.detectCycles());
      res.json(cycles);
    }
  });

  app.post('/api/scan', (req, res) => {
    if (deps.scanning()) { res.status(409).json({ error: 'Scan already in progress' }); return; }
    const { repo } = req.body as { repo?: string };
    if (repo) {
      res.json({ started: true, repo });
      deps.scanRepoFn(repo, true).catch(err => console.error('[gate-keeper] Scan error:', err));
    } else {
      res.json({ started: true, workDir: deps.workDir });
      deps.scanFn(true).catch(err => console.error('[gate-keeper] Scan error:', err));
    }
  });

  app.get('/api/file-detail', (req, res) => {
    const filePath = req.query['file'] as string;
    const repo = req.query['repo'] as string;
    if (!filePath || !repo) { res.status(400).json({ error: 'file and repo query params required' }); return; }
    const analysis = deps.cache.get(filePath, repo);
    if (!analysis) { res.status(404).json({ error: 'File not in cache' }); return; }
    const { breakdown } = deps.ratingCalc.calculateWithBreakdown(analysis.violations, analysis.metrics, analysis.dependencies);
    const graph = deps.graphs.get(repo);
    const cycles = graph ? graph.detectCycles() : [];
    const refactoringHints = deps.refactoringAdvisor.suggest(analysis, cycles);
    res.json({ analysis, ratingBreakdown: breakdown, gitDiff: getGitDiffStats(filePath), refactoringHints });
  });

  app.get('/api/positions', (req, res) => {
    const repo = req.query['repo'] as string;
    if (!repo) { res.status(400).json({ error: 'repo param required' }); return; }
    res.json(deps.cache.getNodePositions(repo));
  });

  app.post('/api/positions', (req, res) => {
    const { repo, nodeId, x, y } = req.body as { repo: string; nodeId: string; x: number; y: number };
    if (!repo || !nodeId || x == null || y == null) { res.status(400).json({ error: 'repo, nodeId, x, y required' }); return; }
    deps.cache.saveNodePosition(repo, nodeId, x, y);
    res.json({ ok: true });
  });

  app.post('/api/clear', (req, res) => {
    const { repo } = req.body as { repo: string };
    if (!repo) { res.status(400).json({ error: 'repo parameter required' }); return; }
    const deleted = deps.cache.clearRepo(repo);
    deps.graphs.delete(repo);
    console.error(`[gate-keeper] Cleared ${deleted} analyses for repo: ${repo}`);
    res.json({ ok: true, deleted });
  });

  app.delete('/api/repos', (req, res) => {
    const { repoRoot } = req.body as { repoRoot: string };
    if (!repoRoot) { res.status(400).json({ error: 'repoRoot parameter required' }); return; }
    const repoRecord = deps.cache.getRepositoryByPath(repoRoot);
    const deletedAnalyses = deps.cache.clearRepo(repoRoot);
    deps.graphs.delete(repoRoot);
    const deletedRepo = repoRecord ? deps.cache.deleteRepository(repoRecord.id) : 0;
    console.error(`[gate-keeper] Deleted repo: ${repoRoot} (${deletedAnalyses} analyses, registry: ${deletedRepo})`);
    res.json({ ok: true, deletedAnalyses, deletedRepo });
  });

  app.get('/api/exclude-patterns', (req, res) => {
    const repo = req.query['repo'] as string;
    if (!repo) { res.status(400).json({ error: 'repo param required' }); return; }
    res.json(deps.cache.getExcludePatterns(repo));
  });

  app.post('/api/exclude-patterns', (req, res) => {
    const { repo, pattern, label } = req.body as { repo: string; pattern: string; label?: string };
    if (!repo || !pattern) { res.status(400).json({ error: 'repo and pattern required' }); return; }
    if (pattern.length > 200) { res.status(400).json({ error: 'Pattern too long (max 200 chars)' }); return; }
    const id = deps.cache.addExcludePattern(repo, pattern, label);
    res.json({ ok: true, id });
  });

  app.delete('/api/exclude-patterns/:id', (req, res) => {
    const id = parseInt(req.params['id'], 10);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }
    const ok = deps.cache.removeExcludePattern(id);
    res.json({ ok });
  });

  app.get('/api/scan-config', (_req, res) => {
    res.json({ scanExcludePatterns: deps.config.scanExcludePatterns ?? { global: [], csharp: [], typescript: [] } });
  });

  app.get('/api/scan-logs', (_req, res) => { res.json([]); });

  app.get('/api/config', (_req, res) => { res.json(deps.getLiveConfig()); });

  app.put('/api/config', (req, res) => {
    const payload = req.body as Partial<Config>;
    const current = deps.getLiveConfig();
    const merged: Config = {
      minRating: typeof payload.minRating === 'number' ? payload.minRating : current.minRating,
      scanExcludePatterns: {
        global: payload.scanExcludePatterns?.global ?? current.scanExcludePatterns?.global ?? [],
        csharp: payload.scanExcludePatterns?.csharp ?? current.scanExcludePatterns?.csharp ?? [],
        typescript: payload.scanExcludePatterns?.typescript ?? current.scanExcludePatterns?.typescript ?? [],
      },
    };
    if (Number.isNaN(merged.minRating) || merged.minRating < 0 || merged.minRating > 10) {
      res.status(400).json({ error: 'minRating must be between 0 and 10' });
      return;
    }
    try {
      const fs = require('fs');
      fs.mkdirSync(GK_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
      deps.appendScanLog('Configuration updated', 'info');
      res.json({ ok: true, config: merged });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/patterns', (req, res) => {
    const repo = req.query['repo'] as string | undefined;
    const analyses = deps.cache.getAll(repo);
    const reports = deps.patternDetector.detect(analyses);
    res.json(reports);
  });

  /**
   * GET /api/impact-set?file=...&repo=...&depth=2
   *
   * Returns the same data as the get_impact_set MCP tool — a depth-bounded BFS
   * over reverse dependencies. Used by the PreToolUse hook to check edit safety.
   */
  app.get('/api/impact-set', (req, res) => {
    const filePath = req.query['file'] as string;
    const repo = req.query['repo'] as string;
    const depth = Math.min(Number(req.query['depth'] ?? 2), 5);

    if (!filePath || !repo) {
      res.status(400).json({ error: 'file and repo query params required' });
      return;
    }

    const graph = deps.graphs.get(repo);
    if (!graph) {
      res.json({ filePath, depth, affected: [], fragileCount: 0, riskScore: 0 });
      return;
    }

    const gd = graph.toGraphData();
    const revAdj = new Map<string, string[]>();
    for (const e of gd.edges) {
      const sources = revAdj.get(e.target) ?? [];
      sources.push(e.source);
      revAdj.set(e.target, sources);
    }

    const ratings = new Map(gd.nodes.map(n => [n.id, n.rating]));
    const fileNode = gd.nodes.find(n => n.id === filePath);

    // BFS over reverse adjacency
    const visited = new Set<string>();
    const queue: Array<{ id: string; d: number }> = [{ id: filePath, d: 0 }];
    const affected: Array<{ path: string; depth: number; severity: string; rating: number; fragile: boolean }> = [];

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      if (d > depth) continue;
      if (id !== filePath) {
        const r = ratings.get(id) ?? 10;
        affected.push({
          path: id, depth: d,
          severity: d === 1 ? 'direct' : 'indirect',
          rating: r, fragile: r < 6,
        });
      }
      for (const dependent of revAdj.get(id) ?? []) {
        if (!visited.has(dependent) && dependent !== filePath) {
          visited.add(dependent);
          if (d < depth) queue.push({ id: dependent, d: d + 1 });
        }
      }
    }

    const fragileCount = affected.filter(e => e.fragile).length;
    const riskScore = fragileCount >= 3 ? 10 : fragileCount >= 1 ? 5 : 0;
    const verdict = fragileCount >= 3 ? 'block' : fragileCount >= 1 ? 'warn' : 'safe';

    const fileRating = fileNode?.rating ?? null;
    const directDepCount = affected.filter(e => e.severity === 'direct').length;

    res.json({
      filePath, depth,
      affected,
      fragileCount,
      directDependents: directDepCount,
      riskScore,
      verdict,
      fileRating,
      reason: verdict === 'block'
        ? `${fragileCount} fragile dependents — high risk of cascading failures`
        : verdict === 'warn'
          ? `${fragileCount} fragile dependent(s) — verify after change`
          : 'Low blast radius',
    });
  });

  // Get architecture config for a repo
  app.get('/api/arch', (req, res) => {
    const repo = req.query['repo'] as string | undefined;
    if (!repo) {
      res.status(400).json({ error: 'repo query parameter is required' });
      return;
    }
    try {
      const archConfig = readArchConfig(repo);
      res.json(archConfig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Set layer override for a file
  app.put('/api/arch', (req, res) => {
    const { repo, filePath, layer } = req.body as { repo: string; filePath: string; layer: string };
    if (!repo || !filePath || !layer) {
      res.status(400).json({ error: 'repo, filePath, and layer are required' });
      return;
    }
    try {
      const relPath = path.relative(repo, filePath);
      setLayerOverride(repo, relPath, layer);
      const archConfig = readArchConfig(repo);
      res.json(archConfig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });
}
