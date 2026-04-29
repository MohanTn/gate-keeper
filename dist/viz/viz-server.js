"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VizServer = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = require("ws");
const path = __importStar(require("path"));
const open_1 = __importDefault(require("open"));
const dependency_graph_1 = require("../graph/dependency-graph");
const VIZ_PORT = 5378;
class VizServer {
    app = (0, express_1.default)();
    server = (0, http_1.createServer)(this.app);
    wss = new ws_1.WebSocketServer({ server: this.server });
    graph = new dependency_graph_1.DependencyGraph();
    cache;
    hasAutoOpened = false;
    constructor(cache) {
        this.cache = cache;
        this.loadFromCache();
        this.setupRoutes();
        this.setupWebSocket();
    }
    loadFromCache() {
        for (const analysis of this.cache.getAll()) {
            this.graph.upsert(analysis);
        }
    }
    setupRoutes() {
        this.app.use(express_1.default.json());
        const dashboardBuild = path.join(__dirname, '../../dashboard/dist');
        this.app.use('/viz', express_1.default.static(dashboardBuild));
        this.app.get('/', (_req, res) => res.redirect('/viz'));
        this.app.get('/api/graph', (_req, res) => {
            res.json(this.graph.toGraphData());
        });
        this.app.get('/api/hotspots', (_req, res) => {
            res.json(this.graph.findHotspots());
        });
        this.app.get('/api/trends', (req, res) => {
            const filePath = req.query['file'];
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
    setupWebSocket() {
        this.wss.on('connection', ws => {
            ws.send(JSON.stringify({
                type: 'init',
                data: this.graph.toGraphData()
            }));
            ws.on('error', err => {
                console.error('[gate-keeper] WebSocket error:', err.message);
            });
        });
    }
    pushAnalysis(analysis) {
        this.graph.upsert(analysis);
        const graphData = this.graph.toGraphData();
        const updatedNode = graphData.nodes.find(n => n.id === analysis.path);
        const updatedEdges = graphData.edges.filter(e => e.source === analysis.path || e.target === analysis.path);
        const msg = {
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
    broadcast(msg) {
        const json = JSON.stringify(msg);
        this.wss.clients.forEach(client => {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(json);
            }
        });
    }
    maybeAutoOpen() {
        if (this.hasAutoOpened)
            return;
        const rating = this.graph.overallRating();
        if (rating < 5.0) {
            (0, open_1.default)(`http://localhost:${VIZ_PORT}/viz`, { wait: false }).catch(() => { });
            this.hasAutoOpened = true;
            console.error(`[gate-keeper] Architecture issues detected (rating ${rating}/10) — opening dashboard`);
        }
    }
    start() {
        return new Promise(resolve => {
            this.server.listen(VIZ_PORT, () => {
                console.error(`[gate-keeper] Dashboard: http://localhost:${VIZ_PORT}/viz`);
                resolve();
            });
        });
    }
    stop() {
        this.server.close();
        this.wss.close();
    }
}
exports.VizServer = VizServer;
//# sourceMappingURL=viz-server.js.map