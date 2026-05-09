import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { FileAnalysis, RepoMetadata } from '../types';

interface RepoRow {
  id: string;
  path: string;
  name: string;
  session_id: string | null;
  session_type: string;
  created_at: number;
  last_analyzed: number | null;
  file_count: number;
  overall_rating: number;
  is_active: number;
}

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

      CREATE TABLE IF NOT EXISTS repositories (
        id             TEXT    PRIMARY KEY,
        path           TEXT    NOT NULL UNIQUE,
        name           TEXT    NOT NULL,
        session_id     TEXT,
        session_type   TEXT    DEFAULT 'unknown',
        created_at     INTEGER NOT NULL,
        last_analyzed  INTEGER,
        file_count     INTEGER DEFAULT 0,
        overall_rating REAL    DEFAULT 10.0,
        is_active      INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_analyses_repo ON analyses(repo);
      CREATE INDEX IF NOT EXISTS idx_rh_repo_path  ON rating_history(repo, path);
      CREATE INDEX IF NOT EXISTS idx_rh_time       ON rating_history(recorded_at);
      CREATE INDEX IF NOT EXISTS idx_repos_session ON repositories(session_id);
      CREATE INDEX IF NOT EXISTS idx_repos_active  ON repositories(is_active);

      CREATE TABLE IF NOT EXISTS exclude_patterns (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        repo    TEXT    NOT NULL,
        pattern TEXT    NOT NULL,
        label   TEXT,
        UNIQUE(repo, pattern)
      );
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

  deleteFile(filePath: string, repoRoot: string): boolean {
    const deleted = this.db.prepare('DELETE FROM analyses WHERE repo = ? AND path = ?').run(repoRoot, filePath).changes;
    this.db.prepare('DELETE FROM rating_history WHERE repo = ? AND path = ?').run(repoRoot, filePath);
    this.db.prepare('DELETE FROM node_positions WHERE repo = ? AND node_id = ?').run(repoRoot, filePath);
    return deleted > 0;
  }

  clearRepo(repo: string): number {
    const deletedAnalyses = this.db.prepare('DELETE FROM analyses WHERE repo = ?').run(repo).changes;
    this.db.prepare('DELETE FROM rating_history WHERE repo = ?').run(repo);
    this.db.prepare('DELETE FROM node_positions WHERE repo = ?').run(repo);
    return deletedAnalyses;
  }

  // Repository management
  saveRepository(repo: RepoMetadata): void {
    // ON CONFLICT preserves created_at / stats; only mutable session fields are updated
    this.db.prepare(`
      INSERT INTO repositories (id, path, name, session_id, session_type, created_at, last_analyzed, file_count, overall_rating, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name        = excluded.name,
        session_id  = excluded.session_id,
        session_type = excluded.session_type,
        is_active   = excluded.is_active
    `).run(
      repo.id,
      repo.path,
      repo.name,
      repo.sessionId || null,
      repo.sessionType,
      repo.createdAt,
      repo.lastAnalyzedAt || null,
      repo.fileCount || 0,
      repo.overallRating || 10.0,
      repo.isActive ? 1 : 0
    );
  }

  getRepository(repoId: string): RepoMetadata | null {
    const row = this.db
      .prepare('SELECT * FROM repositories WHERE id = ?')
      .get(repoId) as RepoRow | undefined;
    return row ? this.rowToRepoMetadata(row) : null;
  }

  getRepositoryByPath(repoPath: string): RepoMetadata | null {
    const row = this.db
      .prepare('SELECT * FROM repositories WHERE path = ?')
      .get(repoPath) as RepoRow | undefined;
    return row ? this.rowToRepoMetadata(row) : null;
  }

  getAllRepositories(activeOnly = false): RepoMetadata[] {
    const query = activeOnly
      ? 'SELECT * FROM repositories WHERE is_active = 1 ORDER BY created_at DESC'
      : 'SELECT * FROM repositories ORDER BY created_at DESC';
    const rows = this.db.prepare(query).all() as RepoRow[];
    return rows.map(r => this.rowToRepoMetadata(r));
  }

  getRepositoriesBySession(sessionId: string): RepoMetadata[] {
    const rows = this.db
      .prepare('SELECT * FROM repositories WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as RepoRow[];
    return rows.map(r => this.rowToRepoMetadata(r));
  }

  updateRepositoryStats(repoId: string, fileCount: number, overallRating: number): void {
    this.db.prepare(`
      UPDATE repositories 
      SET file_count = ?, overall_rating = ?, last_analyzed = ?
      WHERE id = ?
    `).run(fileCount, overallRating, Date.now(), repoId);
  }

  deleteRepository(repoId: string): number {
    const repo = this.getRepository(repoId);
    if (!repo) return 0;
    this.clearRepo(repo.path);
    return this.db.prepare('DELETE FROM repositories WHERE id = ?').run(repoId).changes;
  }

  private rowToRepoMetadata(row: RepoRow): RepoMetadata {
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      sessionId: row.session_id ?? undefined,
      sessionType: (row.session_type as RepoMetadata['sessionType']) || 'unknown',
      createdAt: row.created_at,
      lastAnalyzedAt: row.last_analyzed ?? undefined,
      fileCount: row.file_count,
      overallRating: row.overall_rating,
      isActive: row.is_active === 1
    };
  }

  close(): void {
    this.db.close();
  }

  // Exclude patterns
  getExcludePatterns(repo: string): Array<{ id: number; pattern: string; label: string | null }> {
    return this.db
      .prepare('SELECT id, pattern, label FROM exclude_patterns WHERE repo = ? ORDER BY id')
      .all(repo) as Array<{ id: number; pattern: string; label: string | null }>;
  }

  addExcludePattern(repo: string, pattern: string, label?: string): number {
    const result = this.db.prepare(
      'INSERT OR IGNORE INTO exclude_patterns (repo, pattern, label) VALUES (?, ?, ?)'
    ).run(repo, pattern, label ?? null);
    return result.lastInsertRowid as number;
  }

  removeExcludePattern(id: number): boolean {
    return this.db.prepare('DELETE FROM exclude_patterns WHERE id = ?').run(id).changes > 0;
  }
}
