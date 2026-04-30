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
    this.migrate();
    this.init();
  }

  private migrate(): void {
    // Drop old single-tenant schema (no `repo` column) so we start clean.
    const cols = this.db.prepare('PRAGMA table_info(analyses)').all() as { name: string }[];
    if (cols.length > 0 && !cols.some(c => c.name === 'repo')) {
      this.db.exec('DROP TABLE IF EXISTS analyses; DROP TABLE IF EXISTS rating_history;');
    }
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        repo         TEXT    NOT NULL,
        path         TEXT    NOT NULL,
        language     TEXT    NOT NULL,
        data         TEXT    NOT NULL,
        rating       REAL    NOT NULL,
        analyzed_at  INTEGER NOT NULL,
        PRIMARY KEY (repo, path)
      );

      CREATE TABLE IF NOT EXISTS rating_history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        repo         TEXT    NOT NULL,
        path         TEXT    NOT NULL,
        rating       REAL    NOT NULL,
        recorded_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS node_positions (
        repo     TEXT NOT NULL,
        node_id  TEXT NOT NULL,
        x        REAL NOT NULL,
        y        REAL NOT NULL,
        PRIMARY KEY (repo, node_id)
      );

      CREATE INDEX IF NOT EXISTS idx_analyses_repo ON analyses(repo);
      CREATE INDEX IF NOT EXISTS idx_rh_repo_path  ON rating_history(repo, path);
      CREATE INDEX IF NOT EXISTS idx_rh_time       ON rating_history(recorded_at);
    `);
  }

  save(analysis: FileAnalysis): void {
    const repo = analysis.repoRoot ?? '';
    this.db.prepare(`
      INSERT OR REPLACE INTO analyses (repo, path, language, data, rating, analyzed_at)
      VALUES (@repo, @path, @language, @data, @rating, @analyzed_at)
    `).run({
      repo,
      path: analysis.path,
      language: analysis.language,
      data: JSON.stringify(analysis),
      rating: analysis.rating,
      analyzed_at: analysis.analyzedAt
    });

    this.db.prepare(`
      INSERT INTO rating_history (repo, path, rating, recorded_at)
      VALUES (@repo, @path, @rating, @recorded_at)
    `).run({ repo, path: analysis.path, rating: analysis.rating, recorded_at: analysis.analyzedAt });
  }

  get(filePath: string, repoRoot: string): FileAnalysis | null {
    const row = this.db
      .prepare('SELECT data FROM analyses WHERE repo = ? AND path = ?')
      .get(repoRoot, filePath) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as FileAnalysis) : null;
  }

  getAll(repoRoot?: string): FileAnalysis[] {
    const rows = (repoRoot
      ? this.db.prepare('SELECT data FROM analyses WHERE repo = ? ORDER BY analyzed_at DESC').all(repoRoot)
      : this.db.prepare('SELECT data FROM analyses ORDER BY analyzed_at DESC').all()
    ) as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as FileAnalysis);
  }

  getRepos(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT repo FROM analyses WHERE repo != \'\' ORDER BY repo')
      .all() as { repo: string }[];
    return rows.map(r => r.repo);
  }

  getRatingHistory(filePath: string, repoRoot: string, limit = 20): Array<{ rating: number; recorded_at: number }> {
    return this.db
      .prepare('SELECT rating, recorded_at FROM rating_history WHERE repo = ? AND path = ? ORDER BY recorded_at DESC LIMIT ?')
      .all(repoRoot, filePath, limit) as Array<{ rating: number; recorded_at: number }>;
  }

  getOverallRating(repoRoot: string): number {
    const row = this.db
      .prepare('SELECT AVG(rating) as avg FROM analyses WHERE repo = ?')
      .get(repoRoot) as { avg: number | null };
    return row.avg ?? 10;
  }

  saveNodePosition(repo: string, nodeId: string, x: number, y: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO node_positions (repo, node_id, x, y) VALUES (?, ?, ?, ?)
    `).run(repo, nodeId, x, y);
  }

  getNodePositions(repo: string): Array<{ nodeId: string; x: number; y: number }> {
    return (this.db
      .prepare('SELECT node_id, x, y FROM node_positions WHERE repo = ?')
      .all(repo) as Array<{ node_id: string; x: number; y: number }>)
      .map(r => ({ nodeId: r.node_id, x: r.x, y: r.y }));
  }

  close(): void {
    this.db.close();
  }
}
