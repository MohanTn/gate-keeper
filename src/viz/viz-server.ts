import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import open from 'open';
import { DependencyGraph } from '../graph/dependency-graph';
import { SqliteCache } from '../cache/sqlite-cache';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { RatingCalculator } from '../rating/rating-calculator';
import { FileAnalysis, GraphData, GraphNode, WSMessage } from '../types';

const VIZ_PORT = 5378;

const SCAN_EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', 'out',
  'coverage', 'vendor', '.cache', '__pycache__', 'bin', 'obj'
]);

function* walkFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      yield* walkFiles(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

function getGitDiffStats(filePath: string): { added: number; removed: number } | null {
  try {
    const numstat = spawnSync('git', ['diff', '--numstat', 'HEAD', '--', filePath], {
      encoding: 'utf8', timeout: 5000
    });
    const line = numstat.stdout?.trim();
    if (line) {
      const parts = line.split('\t');
      return { added: parseInt(parts[0], 10) || 0, removed: parseInt(parts[1], 10) || 0 };
    }

    const status = spawnSync('git', ['status', '--porcelain', '--', filePath], {
      encoding: 'utf8', timeout: 5000
    });
    const statusLine = status.stdout?.trim() ?? '';
    if (statusLine.startsWith('??') || statusLine.startsWith('A ')) {
      const wc = spawnSync('wc', ['-l', filePath], { encoding: 'utf8' });
      const lines = parseInt(wc.stdout?.trim().split(' ')[0] ?? '0', 10) || 0;
      return { added: lines, removed: 0 };
    }

    return { added: 0, removed: 0 };
  } catch {
    return null;
  }
}

// WebSocket client extended with a repo filter
interface FilteredClient extends WebSocket {
  __repo: string | null;
}

export class VizServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocketServer({ server: this.server });
  private graphs = new Map<string, DependencyGraph>();
  private cache: SqliteCache;
  private analyzer: UniversalAnalyzer;
  private ratingCalc = new RatingCalculator();
  private hasAutoOpened = false;
  private scanning = false;
  private workDir: string;
  private repoRoot: string;

  constructor(
    cache: SqliteCache,
    analyzer: UniversalAnalyzer,
    workDir: string = process.cwd(),
    repoRoot: string = workDir
  ) {
    this.cache = cache;
    this.analyzer = analyzer;
    this.workDir = workDir;
    this.repoRoot = repoRoot;
    this.loadFromCache();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private graphFor(repo: string): DependencyGraph {
    if (!this.graphs.has(repo)) {
      this.graphs.set(repo, new DependencyGraph());
    }
    return this.graphs.get(repo)!;
  }

  private mergedGraphData(): GraphData {
    const nodes: GraphNode[] = [];
    const edges: { source: string; target: string; type: string; strength: number }[] = [];
    for (const g of this.graphs.values()) {
      const gd = g.toGraphData();
      nodes.push(...gd.nodes);
      edges.push(...gd.edges as any);
    }
    return { nodes, edges };
  }

  private loadFromCache(): void {
    for (const analysis of this.cache.getAll()) {
      if (analysis.repoRoot) {
        this.graphFor(analysis.repoRoot).upsert(analysis);
      }
    }
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    const dashboardBuild = path.join(__dirname, '../../dashboard/dist');
    this.app.use('/viz', express.static(dashboardBuild));

    this.app.get('/', (_req, res) => res.redirect('/viz'));

    this.app.get('/api/repos', (_req, res) => {
      const repos = this.cache.getRepos();
      res.json(repos.map(repo => ({
        repoRoot: repo,
        label: path.basename(repo),
        fileCount: this.graphs.get(repo)?.toGraphData().nodes.length ?? 0
      })));
    });

    this.app.get('/api/graph', (req, res) => {
      const repo = req.query['repo'] as string | undefined;
      res.json(repo ? this.graphFor(repo).toGraphData() : this.mergedGraphData());
    });

    this.app.get('/api/hotspots', (req, res) => {
      const repo = req.query['repo'] as string | undefined;
      if (repo) {
        res.json(this.graphFor(repo).findHotspots());
      } else {
        const all: FileAnalysis[] = [];
        for (const g of this.graphs.values()) all.push(...g.findHotspots(10));
        res.json(all.sort((a, b) => a.rating - b.rating).slice(0, 5));
      }
    });

    this.app.get('/api/trends', (req, res) => {
      const filePath = req.query['file'] as string;
      const repo = req.query['repo'] as string;
      if (!filePath || !repo) {
        res.status(400).json({ error: 'file and repo query params required' });
        return;
      }
      res.json(this.cache.getRatingHistory(filePath, repo));
    });

    this.app.get('/api/status', (req, res) => {
      const repo = req.query['repo'] as string | undefined;
      const graph = repo ? this.graphs.get(repo) : null;
      res.json({
        running: true,
        port: VIZ_PORT,
        overallRating: graph ? graph.overallRating() : this.mergedOverallRating(),
        cycles: graph ? graph.detectCycles().length : 0,
        scanning: this.scanning
      });
    });

    this.app.get('/api/cycles', (req, res) => {
      const repo = req.query['repo'] as string | undefined;
      if (repo) {
        res.json(this.graphFor(repo).detectCycles());
      } else {
        const cycles: any[] = [];
        for (const g of this.graphs.values()) cycles.push(...g.detectCycles());
        res.json(cycles);
      }
    });

    this.app.post('/api/scan', (_req, res) => {
      if (this.scanning) {
        res.status(409).json({ error: 'Scan already in progress' });
        return;
      }
      res.json({ started: true, workDir: this.workDir });
      this.scan(true).catch(err => {
        console.error('[gate-keeper] Scan error:', err);
      });
    });

    this.app.get('/api/file-detail', (req, res) => {
      const filePath = req.query['file'] as string;
      const repo = req.query['repo'] as string;
      if (!filePath || !repo) {
        res.status(400).json({ error: 'file and repo query params required' });
        return;
      }

      const analysis = this.cache.get(filePath, repo);
      if (!analysis) {
        res.status(404).json({ error: 'File not in cache' });
        return;
      }

      const { breakdown } = this.ratingCalc.calculateWithBreakdown(
        analysis.violations,
        analysis.metrics,
        analysis.dependencies
      );

      res.json({ analysis, ratingBreakdown: breakdown, gitDiff: getGitDiffStats(filePath) });
    });

    this.app.get('/api/positions', (req, res) => {
      const repo = req.query['repo'] as string;
      if (!repo) { res.status(400).json({ error: 'repo param required' }); return; }
      res.json(this.cache.getNodePositions(repo));
    });

    this.app.post('/api/positions', (req, res) => {
      const { repo, nodeId, x, y } = req.body as {
        repo: string; nodeId: string; x: number; y: number;
      };
      if (!repo || !nodeId || x == null || y == null) {
        res.status(400).json({ error: 'repo, nodeId, x, y required' });
        return;
      }
      this.cache.saveNodePosition(repo, nodeId, x, y);
      res.json({ ok: true });
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const repo = url.searchParams.get('repo') ?? null;
      (ws as FilteredClient).__repo = repo;

      const graphData = repo
        ? this.graphFor(repo).toGraphData()
        : this.mergedGraphData();

      ws.send(JSON.stringify({ type: 'init', data: graphData } satisfies WSMessage));

      ws.on('error', err => {
        console.error('[gate-keeper] WebSocket error:', err.message);
      });
    });
  }

  async scan(force = false): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;

    // Walk workDir + every repo root previously seen in the cache
    const roots = new Set<string>([this.workDir, ...this.cache.getRepos()]);

    // For incremental scans, skip any path already cached across all repos
    const cachedPaths = force
      ? new Set<string>()
      : new Set(this.cache.getAll().map(a => a.path));

    const seen = new Set<string>();
    const toScan: Array<{ filePath: string; root: string }> = [];
    for (const root of roots) {
      for (const filePath of walkFiles(root)) {
        if (!seen.has(filePath) && this.analyzer.isSupportedFile(filePath) && !cachedPaths.has(filePath)) {
          seen.add(filePath);
          toScan.push({ filePath, root });
        }
      }
    }

    this.broadcast({ type: 'scan_start', scanTotal: toScan.length } satisfies WSMessage);
    console.error(`[gate-keeper] Scan: ${toScan.length} files across ${roots.size} workspace(s)`);

    if (toScan.length === 0) {
      this.broadcast({ type: 'scan_complete', scanTotal: 0, scanAnalyzed: 0 } satisfies WSMessage);
      this.scanning = false;
      return;
    }

    const CONCURRENCY = 8;
    let analyzed = 0;
    for (let i = 0; i < toScan.length; i += CONCURRENCY) {
      const batch = toScan.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async ({ filePath, root }) => {
          try {
            const analysis = await this.analyzer.analyze(filePath);
            if (!analysis) return;
            analysis.repoRoot = root;
            this.cache.save(analysis);
            this.pushAnalysis(analysis);
            analyzed++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[gate-keeper] Scan error for ${filePath}: ${msg}`);
          }
        })
      );
    }

    this.broadcast({
      type: 'scan_complete',
      scanTotal: toScan.length,
      scanAnalyzed: analyzed
    } satisfies WSMessage);
    console.error(`[gate-keeper] Scan complete: ${analyzed}/${toScan.length}`);
    this.scanning = false;
  }

  pushAnalysis(analysis: FileAnalysis): void {
    const repo = analysis.repoRoot ?? this.repoRoot;
    const graph = this.graphFor(repo);
    graph.upsert(analysis);

    const graphData = graph.toGraphData();
    const updatedNode = graphData.nodes.find(n => n.id === analysis.path);
    const updatedEdges = graphData.edges.filter(
      e => e.source === analysis.path || e.target === analysis.path
    );

    this.broadcast({
      type: 'update',
      delta: {
        nodes: updatedNode ? [updatedNode] : [],
        edges: updatedEdges as any
      },
      analysis
    } satisfies WSMessage, repo);

    this.maybeAutoOpen(repo);
  }

  private broadcast(msg: WSMessage, repoFilter?: string): void {
    const json = JSON.stringify(msg);
    this.wss.clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;
      const clientRepo = (client as FilteredClient).__repo;
      // Send if client has no filter, or filters match, or message has no filter
      if (!clientRepo || !repoFilter || clientRepo === repoFilter) {
        client.send(json);
      }
    });
  }

  private mergedOverallRating(): number {
    const graphs = Array.from(this.graphs.values());
    if (graphs.length === 0) return 10;
    const sum = graphs.reduce((a, g) => a + g.overallRating(), 0);
    return Math.round((sum / graphs.length) * 10) / 10;
  }

  private maybeAutoOpen(repo: string): void {
    if (this.hasAutoOpened) return;
    const rating = this.graphs.get(repo)?.overallRating() ?? 10;
    if (rating < 5.0) {
      open(`http://localhost:${VIZ_PORT}/viz`, { wait: false }).catch(() => {});
      this.hasAutoOpened = true;
      console.error(`[gate-keeper] Architecture issues (rating ${rating}/10) — opening dashboard`);
    }
  }

  start(): Promise<void> {
    return new Promise(resolve => {
      this.server.listen(VIZ_PORT, () => {
        console.error(`[gate-keeper] Dashboard: http://localhost:${VIZ_PORT}/viz`);
        resolve();
      });
    });
  }

  stop(): void {
    this.server.close();
    this.wss.close();
  }
}
