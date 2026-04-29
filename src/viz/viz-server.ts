import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import open from 'open';
import { DependencyGraph } from '../graph/dependency-graph';
import { SqliteCache } from '../cache/sqlite-cache';
import { FileAnalysis, GraphData, WSMessage } from '../types';

const VIZ_PORT = 5378;

export class VizServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocketServer({ server: this.server });
  private graph = new DependencyGraph();
  private cache: SqliteCache;
  private hasAutoOpened = false;

  constructor(cache: SqliteCache) {
    this.cache = cache;
    this.loadFromCache();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private loadFromCache(): void {
    for (const analysis of this.cache.getAll()) {
      this.graph.upsert(analysis);
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
        cycles: this.graph.detectCycles().length
      });
    });

    this.app.get('/api/cycles', (_req, res) => {
      res.json(this.graph.detectCycles());
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
      console.error(`[gate-keeper] Architecture issues detected (rating ${rating}/10) — opening dashboard`);
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
