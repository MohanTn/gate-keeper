"use strict";
/**
 * gate-keeper hook-receiver
 *
 * Called by Claude Code's PostToolUse hook on every Write/Edit operation.
 * Must exit in < 100ms — all heavy work is delegated to the daemon.
 *
 * Reads JSON from stdin, extracts the file path, wakes the daemon (starting
 * it in the background if needed), then exits immediately.
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
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const IPC_PORT = 5379;
const PID_FILE = path.join(process.env.HOME ?? '/tmp', '.gate-keeper', 'daemon.pid');
const DAEMON_SCRIPT = path.join(__dirname, 'daemon.js');
const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);
async function main() {
    const payload = await readStdin();
    if (!payload)
        return;
    const filePath = payload.tool_input?.file_path ?? payload.tool_input?.path;
    if (!filePath)
        return;
    const ext = path.extname(filePath);
    if (!WATCHED_EXTENSIONS.has(ext))
        return;
    await ensureDaemonRunning();
    await sendToDaemon(filePath);
}
function readStdin() {
    return new Promise(resolve => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => (data += chunk));
        process.stdin.on('end', () => {
            try {
                resolve(JSON.parse(data));
            }
            catch {
                resolve(null);
            }
        });
        // Don't block if stdin never closes
        setTimeout(() => resolve(null), 2000);
    });
}
async function ensureDaemonRunning() {
    if (isDaemonAlive())
        return;
    if (!fs.existsSync(DAEMON_SCRIPT))
        return;
    const child = (0, child_process_1.spawn)(process.execPath, [DAEMON_SCRIPT], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env }
    });
    child.unref();
    // Give the daemon a moment to bind its port
    await sleep(300);
}
function isDaemonAlive() {
    try {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (isNaN(pid))
            return false;
        process.kill(pid, 0); // throws if process doesn't exist
        return true;
    }
    catch {
        return false;
    }
}
function sendToDaemon(filePath) {
    return new Promise(resolve => {
        const body = JSON.stringify({ filePath });
        const req = http.request({
            hostname: '127.0.0.1',
            port: IPC_PORT,
            path: '/analyze',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            res.resume();
            res.on('end', resolve);
        });
        req.on('error', () => resolve()); // daemon may not be ready yet — that's fine
        req.setTimeout(1500, () => { req.destroy(); resolve(); });
        req.write(body);
        req.end();
    });
}
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
main().catch(() => { }).finally(() => process.exit(0));
//# sourceMappingURL=hook-receiver.js.map