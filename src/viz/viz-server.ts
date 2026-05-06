import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import open from 'open';
import { DependencyGraph } from '../graph/dependency-graph';
import { SqliteCache } from '../cache/sqlite-cache';
import { UniversalAnalyzer } from '../analyzer/universal-analyzer';
import { RatingCalculator } from '../rating/rating-calculator';
import { PatternDetector } from '../analyzer/pattern-detector';
import { RefactoringAdvisor } from '../analyzer/refactoring-advisor';
import { FileAnalysis, Config, GraphData, RepoMetadata, WSMessage } from '../types';
import { registerRoutes } from './viz-routes';
import { scan, scanRepo } from './viz-scanner';

const VIZ_PORT = 5378;
const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
const CONFIG_FILE = path.join(GK_DIR, 'config.json');
const MAX_SCAN_LOGS = 500;

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
  private patternDetector = new PatternDetector();
  private refactoringAdvisor = new RefactoringAdvisor();
  private hasAutoOpened = false;
  private scanning = false;
  private workDir: string;
  private config: Config;
  private scanLogs: Array<{ message: string; level: 'info' | 'warn' | 'error'; timestamp: number }> = [];

  constructor(
    cache: SqliteCache,
    analyzer: UniversalAnalyzer,
    workDir: string = process.cwd(),
    repoRoot: string = workDir,
    config: Config = { minRating: 6.5 }
  ) {
    this.cache = cache;
    this.analyzer = analyzer;
    this.workDir = workDir;
    this.config = config;
    this.loadFromCache();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private graphFor(repo: string): DependencyGraph {
    if (!this.graphs.has(repo)) this.graphs.set(repo, new DependencyGraph());
    return this.graphs.get(repo)!;
  }

  private mergedGraphData(): GraphData {
    const nodes: GraphData['nodes'] = [];
    const edges: GraphData['edges'] = [];
    for (const g of this.graphs.values()) {
      const gd = g.toGraphData();
      nodes.push(...gd.nodes);
      edges.push(...gd.edges);
    }
    return { nodes, edges };
  }

  private loadFromCache(): void {
    for (const analysis of this.cache.getAll()) {
      if (analysis.repoRoot) this.graphFor(analysis.repoRoot).upsert(analysis);
    }
  }

  private setupRoutes(): void {
    this.app.use(express.json());
    registerRoutes(this.app, {
      graphs: this.graphs, cache: this.cache, config: this.config,
      ratingCalc: this.ratingCalc, patternDetector: this.patternDetector,
      refactoringAdvisor: this.refactoringAdvisor,
      scanning: () => this.scanning, setScanning: (v: boolean) => { this.scanning = v; },
      scanFn: (force: boolean) => this.scan(force),
      scanRepoFn: (repo: string, force: boolean) => this.scanRepo(repo, force),
      mergedGraphData: () => this.mergedGraphData(),
      graphFor: (repo: string) => this.graphFor(repo),
      mergedOverallRating: () => this.mergedOverallRating(),
      appendScanLog: (msg: string, level?: 'info' | 'warn' | 'error') => this.appendScanLog(msg, level),
      getLiveConfig: () => this.getLiveConfig(),
      workDir: this.workDir,
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const repo = url.searchParams.get('repo') ?? null;
      (ws as FilteredClient).__repo = repo;
      const graphData = repo ? this.graphFor(repo).toGraphData() : this.mergedGraphData();
      ws.send(JSON.stringify({ type: 'init', data: graphData } satisfies WSMessage));
      ws.on('error', err => console.error('[gate-keeper] WebSocket error:', err.message));
    });
  }

  async scan(force = false): Promise<void> {
    await scan({
      cache: this.cache, analyzer: this.analyzer, config: this.config,
      workDir: this.workDir, graphs: this.graphs,
      graphFor: (repo: string) => this.graphFor(repo),
      broadcast: (msg: WSMessage, repoFilter?: string) => this.broadcast(msg, repoFilter),
      appendScanLog: (msg: string, level?: 'info' | 'warn' | 'error') => this.appendScanLog(msg, level),
      getScanning: () => this.scanning, setScanning: (v: boolean) => { this.scanning = v; },
    });
  }

  async scanRepo(repoRoot: string, force = false): Promise<void> {
    await scanRepo({
      cache: this.cache, analyzer: this.analyzer, config: this.config,
      workDir: this.workDir, graphs: this.graphs,
      graphFor: (repo: string) => this.graphFor(repo),
      broadcast: (msg: WSMessage, repoFilter?: string) => this.broadcast(msg, repoFilter),
      appendScanLog: (msg: string, level?: 'info' | 'warn' | 'error') => this.appendScanLog(msg, level),
      getScanning: () => this.scanning, setScanning: (v: boolean) => { this.scanning = v; },
    }, repoRoot, force);
  }

  pushAnalysis(analysis: FileAnalysis): void {
    const repo = analysis.repoRoot ?? this.workDir;
    const graph = this.graphFor(repo);
    graph.upsert(analysis);
    const graphData = graph.toGraphData();
    const updatedNode = graphData.nodes.find(n => n.id === analysis.path);
    const updatedEdges = graphData.edges.filter(e => e.source === analysis.path || e.target === analysis.path);
    this.broadcast({ type: 'update', delta: { nodes: updatedNode ? [updatedNode] : [], edges: updatedEdges as GraphData['edges'] }, analysis } satisfies WSMessage, repo);
    this.maybeAutoOpen(repo);
  }

  broadcastRepoCreated(repo: RepoMetadata): void {
    this.broadcast({ type: 'repo_created', repo } satisfies WSMessage);
  }

  private broadcast(msg: WSMessage, repoFilter?: string): void {
    const json = JSON.stringify(msg);
    this.wss.clients.forEach(client => {
      const clientRepo = (client as FilteredClient).__repo;
      if (!clientRepo || !repoFilter || clientRepo === repoFilter) client.send(json);
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

  private appendScanLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const entry = { message, level, timestamp: Date.now() };
    this.scanLogs.push(entry);
    if (this.scanLogs.length > MAX_SCAN_LOGS) this.scanLogs = this.scanLogs.slice(-MAX_SCAN_LOGS);
    this.broadcast({ type: 'scan_log', logMessage: entry.message, logLevel: entry.level, logTimestamp: entry.timestamp } satisfies WSMessage);
  }

  private getLiveConfig(): Config {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<Config>;
        return {
          minRating: typeof parsed.minRating === 'number' ? parsed.minRating : this.config.minRating,
          scanExcludePatterns: {
            global: parsed.scanExcludePatterns?.global ?? this.config.scanExcludePatterns?.global ?? [],
            csharp: parsed.scanExcludePatterns?.csharp ?? this.config.scanExcludePatterns?.csharp ?? [],
            typescript: parsed.scanExcludePatterns?.typescript ?? this.config.scanExcludePatterns?.typescript ?? [],
          },
        };
      }
    } catch { /* Fall through */ }
    return {
      minRating: this.config.minRating,
      scanExcludePatterns: {
        global: this.config.scanExcludePatterns?.global ?? [],
        csharp: this.config.scanExcludePatterns?.csharp ?? [],
        typescript: this.config.scanExcludePatterns?.typescript ?? [],
      },
    };
  }

  start(): Promise<void> {
    return new Promise(resolve => {
      this.server.listen(VIZ_PORT, () => {
        console.error(`[gate-keeper] Dashboard: http://localhost:${VIZ_PORT}/viz`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close WebSocket server first, then HTTP server
      this.wss.close(() => {
        this.server.close(() => {
          resolve();
        });
      });
    });
  }
}
