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
exports.SqliteCache = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const DB_PATH = path.join(process.env.HOME ?? '/tmp', '.gate-keeper', 'cache.db');
class SqliteCache {
    db;
    constructor(dbPath = DB_PATH) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.db = new better_sqlite3_1.default(dbPath);
        this.init();
    }
    init() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        path TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        data TEXT NOT NULL,
        rating REAL NOT NULL,
        analyzed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rating_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        rating REAL NOT NULL,
        recorded_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rating_history_path ON rating_history(path);
      CREATE INDEX IF NOT EXISTS idx_rating_history_time ON rating_history(recorded_at);
    `);
    }
    save(analysis) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO analyses (path, language, data, rating, analyzed_at)
      VALUES (@path, @language, @data, @rating, @analyzed_at)
    `);
        stmt.run({
            path: analysis.path,
            language: analysis.language,
            data: JSON.stringify(analysis),
            rating: analysis.rating,
            analyzed_at: analysis.analyzedAt
        });
        const histStmt = this.db.prepare(`
      INSERT INTO rating_history (path, rating, recorded_at) VALUES (@path, @rating, @recorded_at)
    `);
        histStmt.run({ path: analysis.path, rating: analysis.rating, recorded_at: analysis.analyzedAt });
    }
    get(filePath) {
        const row = this.db
            .prepare('SELECT data FROM analyses WHERE path = ?')
            .get(filePath);
        return row ? JSON.parse(row.data) : null;
    }
    getAll() {
        const rows = this.db
            .prepare('SELECT data FROM analyses ORDER BY analyzed_at DESC')
            .all();
        return rows.map(r => JSON.parse(r.data));
    }
    getRatingHistory(filePath, limit = 20) {
        return this.db
            .prepare('SELECT rating, recorded_at FROM rating_history WHERE path = ? ORDER BY recorded_at DESC LIMIT ?')
            .all(filePath, limit);
    }
    getOverallRating() {
        const row = this.db
            .prepare('SELECT AVG(rating) as avg FROM analyses')
            .get();
        return row.avg ?? 10;
    }
    close() {
        this.db.close();
    }
}
exports.SqliteCache = SqliteCache;
//# sourceMappingURL=sqlite-cache.js.map