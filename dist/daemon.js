"use strict";
/**
 * gate-keeper daemon
 *
 * Listens on port 5379 for file paths from the hook-receiver, runs analysis,
 * updates the SQLite cache, and broadcasts results to the dashboard (port 5378).
 *
 * Start with: node dist/daemon.js
 */
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
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const universal_analyzer_1 = require("./analyzer/universal-analyzer");
const sqlite_cache_1 = require("./cache/sqlite-cache");
const viz_server_1 = require("./viz/viz-server");
const IPC_PORT = 5379;
const PID_FILE = path.join(process.env.HOME ?? '/tmp', '.gate-keeper', 'daemon.pid');
async function main() {
    ensurePidFile();
    const cache = new sqlite_cache_1.SqliteCache();
    const analyzer = new universal_analyzer_1.UniversalAnalyzer();
    const vizServer = new viz_server_1.VizServer(cache);
    await vizServer.start();
    // IPC HTTP server — only binds to localhost
    const ipc = (0, express_1.default)();
    ipc.use(express_1.default.json());
    ipc.get('/health', (_req, res) => {
        res.json({ ok: true, pid: process.pid });
    });
    ipc.post('/analyze', async (req, res) => {
        const { filePath } = req.body;
        res.json({ queued: true });
        if (!filePath || !fs.existsSync(filePath))
            return;
        if (!analyzer.isSupportedFile(filePath))
            return;
        try {
            const analysis = await analyzer.analyze(filePath);
            if (!analysis)
                return;
            cache.save(analysis);
            vizServer.pushAnalysis(analysis);
            const rating = analysis.rating;
            const violations = analysis.violations.length;
            console.error(`[gate-keeper] ${path.basename(filePath)} — rating: ${rating}/10, violations: ${violations}`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[gate-keeper] Analysis error for ${filePath}: ${msg}`);
        }
    });
    ipc.listen(IPC_PORT, '127.0.0.1', () => {
        console.error(`[gate-keeper] IPC ready on 127.0.0.1:${IPC_PORT}`);
    });
    process.on('SIGTERM', () => shutdown(cache));
    process.on('SIGINT', () => shutdown(cache));
    console.error(`[gate-keeper] Daemon started (PID ${process.pid})`);
}
function ensurePidFile() {
    const dir = path.dirname(PID_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
}
function shutdown(cache) {
    try {
        fs.unlinkSync(PID_FILE);
    }
    catch { }
    cache.close();
    process.exit(0);
}
main().catch(err => {
    console.error('[gate-keeper] Fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=daemon.js.map