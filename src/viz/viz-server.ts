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
import { FileAnalysis, GraphData, WSMessage } from '../types';

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

    // New or untracked file — every line is an addition
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

export class VizServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocketServer({ server: this.server });
  private graph = new DependencyGraph();
  private cache: SqliteCache;
  private analyzer: UniversalAnalyzer;
  private ratingCalc = new RatingCalculator();
  private hasAutoOpened = false;
  private scanning = false;
  private workDir: string;
  private workspaces = new Set<string>();

  constructor(cache: SqliteCache, analyzer: UniversalAnalyzer, workDir: string = process.cwd()) {
    this.cache = cache;
    this.analyzer = analyzer;
    this.workDir = workDir;
    this.loadFromCache();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private findGitRoot(dir: string): string | null {
    try {
      const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dir, encoding: 'utf8', timeout: 3000
      });
      if (result.status === 0) return result.stdout.trim() || null;
    } catch {}
    return null;
  }

  private registerWorkspace(filePath: string): void {
    const dir = path.dirname(filePath);
    const root = this.findGitRoot(dir) ?? dir;
    if (!this.workspaces.has(root)) {
      this.workspaces.add(root);
      console.error(`[gate-keeper] Workspace discovered: ${root}`);
    }
  }

  private loadFromCache(): void {
    const analyses = this.cache.getAll();
    for (const analysis of analyses) {
      this.graph.upsert(analysis);
    }
    // Derive workspace roots from unique directories in cache — run git once per dir
    const uniqueDirs = new Set(analyses.map(a => path.dirname(a.path)));
    for (const dir of uniqueDirs) {
      const root = this.findGitRoot(dir) ?? dir;
      this.workspaces.add(root);
    }
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    const dashboardBuild = path.join(__dirname, '../../dashboard/dist');
    this.app.use('/viz', express.static(dashboardBuild));

    this.app.get('/', (_req, res) => res.redirect('/viz'));

    this.app.get('/api/graph', (_req, res) => {
      res.json(this.graph.toGraphData());
    });

    this.app.get('/api/hotspots', (_req, res) => {
      res.json(this.graph.findHotspots());
    });

    this.app.get('/api/trends', (req, res) => {
      const filePath = req.query['file'] as string;
      if (!filePath) {
        res.status(400).json({ error: 'file query param required' });
        return;
      }
      res.json(this.cache.getRatingHistory(filePath));
    });

    this.app.get('/api/status', (_req, res) => {
      res.json({
        running: true,
        port: VIZ_PORT,
        overallRating: this.graph.overallRating(),
        cycles: this.graph.detectCycles().length,
        scanning: this.scanning
      });
    });

    this.app.get('/api/cycles', (_req, res) => {
      res.json(this.graph.detectCycles());
    });

    // Trigger a full workspace re-scan from the dashboard
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

    // Per-file detail: git diff stats + rating breakdown
    this.app.get('/api/file-detail', (req, res) => {
      const filePath = req.query['file'] as string;
      if (!filePath) {
        res.status(400).json({ error: 'file query param required' });
        return;
      }

      const analysis = this.cache.get(filePath);
      if (!analysis) {
        res.status(404).json({ error: 'File not in cache' });
        return;
      }

      const { breakdown } = this.ratingCalc.calculateWithBreakdown(
        analysis.violations,
        analysis.metrics,
        analysis.dependencies
      );

      const gitDiff = getGitDiffStats(filePath);

      res.json({ analysis, ratingBreakdown: breakdown, gitDiff });
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', ws => {
      ws.send(
        JSON.stringify({
          type: 'init',
          data: this.graph.toGraphData()
        } satisfies WSMessage)
      );

      ws.on('error', err => {
        console.error('[gate-keeper] WebSocket error:', err.message);
      });
    });
  }

  async scan(force = false): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;

    const cachedPaths = force
      ? new Set<string>()
      : new Set(this.cache.getAll().map(a => a.path));

    const toScan: string[] = [];
    for (const filePath of walkFiles(this.workDir)) {
      if (this.analyzer.isSupportedFile(filePath) && !cachedPaths.has(filePath)) {
        toScan.push(filePath);
      }
    }

    this.broadcast({ type: 'scan_start', scanTotal: toScan.length } satisfies WSMessage);
    console.error(`[gate-keeper] Scan: ${toScan.length} files in ${this.workDir}`);

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
        batch.map(async filePath => {
          try {
            const analysis = await this.analyzer.analyze(filePath);
            if (!analysis) return;
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
    this.graph.upsert(analysis);

    const graphData = this.graph.toGraphData();
    const updatedNode = graphData.nodes.find(n => n.id === analysis.path);
    const updatedEdges = graphData.edges.filter(
      e => e.source === analysis.path || e.target === analysis.path
    );

    const msg: WSMessage = {
      type: 'update',
      delta: {
        nodes: updatedNode ? [updatedNode] : [],
        edges: updatedEdges
      },
      analysis
    };

    this.broadcast(msg);
    this.maybeAutoOpen();
  }

  private broadcast(msg: WSMessage): void {
    const json = JSON.stringify(msg);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    });
  }

  private maybeAutoOpen(): void {
    if (this.hasAutoOpened) return;
    const rating = this.graph.overallRating();
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
