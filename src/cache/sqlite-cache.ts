import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { FileAnalysis } from '../types';

const DB_PATH = path.join(
  process.env.HOME ?? '/tmp',
  '.gate-keeper',
  'cache.db'
);

export class SqliteCache {
  private db: Database.Database;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
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

  save(analysis: FileAnalysis): void {
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

  get(filePath: string): FileAnalysis | null {
    const row = this.db
      .prepare('SELECT data FROM analyses WHERE path = ?')
      .get(filePath) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as FileAnalysis) : null;
  }

  getAll(): FileAnalysis[] {
    const rows = this.db
      .prepare('SELECT data FROM analyses ORDER BY analyzed_at DESC')
      .all() as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as FileAnalysis);
  }

  getRatingHistory(filePath: string, limit = 20): Array<{ rating: number; recorded_at: number }> {
    return this.db
      .prepare('SELECT rating, recorded_at FROM rating_history WHERE path = ? ORDER BY recorded_at DESC LIMIT ?')
      .all(filePath, limit) as Array<{ rating: number; recorded_at: number }>;
  }

  getOverallRating(): number {
    const row = this.db
      .prepare('SELECT AVG(rating) as avg FROM analyses')
      .get() as { avg: number | null };
    return row.avg ?? 10;
  }

  close(): void {
    this.db.close();
  }
}
