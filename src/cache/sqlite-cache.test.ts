import * as fs from 'fs';
import * as path from 'path';
import { SqliteCache } from './sqlite-cache';
import { FileAnalysis, RepoMetadata } from '../types';

describe('SqliteCache', () => {
  let cache: SqliteCache;
  let testDbPath: string;

  beforeAll(() => {
    testDbPath = path.join(__dirname, '../../temp-test-cache-' + Date.now() + '.db');
  });

  beforeEach(() => {
    cache = new SqliteCache(testDbPath);
  });

  afterEach(() => {
    cache.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('save and get', () => {
    it('should save and retrieve file analysis', () => {
      const analysis: FileAnalysis = {
        path: '/src/foo.ts',
        language: 'typescript',
        dependencies: [],
        metrics: {
          linesOfCode: 100,
          cyclomaticComplexity: 5,
          numberOfMethods: 10,
          numberOfClasses: 2,
          importCount: 5,
        },
        violations: [],
        rating: 8,
        analyzedAt: Date.now(),
        repoRoot: '/test/repo',
      };

      cache.save(analysis);

      const retrieved = cache.get('/src/foo.ts', '/test/repo');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.path).toBe('/src/foo.ts');
      expect(retrieved?.rating).toBe(8);
    });

    it('should return null for non-existent file', () => {
      const retrieved = cache.get('/nonexistent.ts', '/test/repo');
      expect(retrieved).toBeNull();
    });

    it('should update existing analysis', () => {
      const analysis1: FileAnalysis = {
        path: '/src/foo.ts',
        language: 'typescript',
        dependencies: [],
        metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
        violations: [],
        rating: 5,
        analyzedAt: Date.now(),
        repoRoot: '/test/repo',
      };

      const analysis2: FileAnalysis = {
        ...analysis1,
        rating: 9,
        analyzedAt: Date.now() + 1000,
      };

      cache.save(analysis1);
      cache.save(analysis2);

      const retrieved = cache.get('/src/foo.ts', '/test/repo');

      expect(retrieved?.rating).toBe(9);
    });

    it('should save analysis with violations', () => {
      const analysis: FileAnalysis = {
        path: '/src/bar.ts',
        language: 'typescript',
        dependencies: [],
        metrics: { linesOfCode: 50, cyclomaticComplexity: 3, numberOfMethods: 5, numberOfClasses: 1, importCount: 2 },
        violations: [
          { type: 'long_method', severity: 'warning', message: 'Method too long', line: 10 },
          { type: 'any_usage', severity: 'warning', message: 'Avoid any type', line: 20 },
        ],
        rating: 6,
        analyzedAt: Date.now(),
        repoRoot: '/test/repo',
      };

      cache.save(analysis);

      const retrieved = cache.get('/src/bar.ts', '/test/repo');

      expect(retrieved?.violations.length).toBe(2);
    });
  });

  describe('getAll', () => {
    it('should return all analyses', () => {
      const analyses: FileAnalysis[] = [
        {
          path: '/src/a.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 8,
          analyzedAt: Date.now(),
          repoRoot: '/test/repo',
        },
        {
          path: '/src/b.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 50, cyclomaticComplexity: 3, numberOfMethods: 5, numberOfClasses: 1, importCount: 2 },
          violations: [],
          rating: 9,
          analyzedAt: Date.now(),
          repoRoot: '/test/repo',
        },
      ];

      cache.save(analyses[0]);
      cache.save(analyses[1]);

      const all = cache.getAll('/test/repo');

      expect(all.length).toBe(2);
    });

    it('should filter by repo when specified', () => {
      const analysis1: FileAnalysis = {
        path: '/src/a.ts',
        language: 'typescript',
        dependencies: [],
        metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
        violations: [],
        rating: 8,
        analyzedAt: Date.now(),
        repoRoot: '/repo1',
      };

      const analysis2: FileAnalysis = {
        path: '/src/b.ts',
        language: 'typescript',
        dependencies: [],
        metrics: { linesOfCode: 50, cyclomaticComplexity: 3, numberOfMethods: 5, numberOfClasses: 1, importCount: 2 },
        violations: [],
        rating: 9,
        analyzedAt: Date.now(),
        repoRoot: '/repo2',
      };

      cache.save(analysis1);
      cache.save(analysis2);

      const repo1Analyses = cache.getAll('/repo1');
      const repo2Analyses = cache.getAll('/repo2');
      const allAnalyses = cache.getAll();

      expect(repo1Analyses.length).toBe(1);
      expect(repo2Analyses.length).toBe(1);
      expect(allAnalyses.length).toBe(2);
    });

    it('should order by analyzedAt descending', () => {
      const now = Date.now();
      const analyses: FileAnalysis[] = [
        {
          path: '/src/old.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 8,
          analyzedAt: now - 1000,
          repoRoot: '/test/repo',
        },
        {
          path: '/src/new.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 50, cyclomaticComplexity: 3, numberOfMethods: 5, numberOfClasses: 1, importCount: 2 },
          violations: [],
          rating: 9,
          analyzedAt: now,
          repoRoot: '/test/repo',
        },
      ];

      cache.save(analyses[0]);
      cache.save(analyses[1]);

      const all = cache.getAll('/test/repo');

      expect(all[0].path).toBe('/src/new.ts');
      expect(all[1].path).toBe('/src/old.ts');
    });
  });

  describe('getRepos', () => {
    it('should return list of unique repos', () => {
      const analyses: FileAnalysis[] = [
        {
          path: '/src/a.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 8,
          analyzedAt: Date.now(),
          repoRoot: '/repo1',
        },
        {
          path: '/src/b.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 50, cyclomaticComplexity: 3, numberOfMethods: 5, numberOfClasses: 1, importCount: 2 },
          violations: [],
          rating: 9,
          analyzedAt: Date.now(),
          repoRoot: '/repo2',
        },
        {
          path: '/src/c.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 75, cyclomaticComplexity: 4, numberOfMethods: 7, numberOfClasses: 1, importCount: 3 },
          violations: [],
          rating: 7,
          analyzedAt: Date.now(),
          repoRoot: '/repo1',
        },
      ];

      for (const analysis of analyses) {
        cache.save(analysis);
      }

      const repos = cache.getRepos();

      expect(repos.length).toBe(2);
      expect(repos).toEqual(expect.arrayContaining(['/repo1', '/repo2']));
    });

    it('should exclude empty repo strings', () => {
      const analysis: FileAnalysis = {
        path: '/src/a.ts',
        language: 'typescript',
        dependencies: [],
        metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
        violations: [],
        rating: 8,
        analyzedAt: Date.now(),
        repoRoot: '',
      };

      cache.save(analysis);

      const repos = cache.getRepos();

      expect(repos).not.toContain('');
    });
  });

  describe('getRatingHistory', () => {
    it('should return rating history for a file', () => {
      const now = Date.now();
      const analyses: FileAnalysis[] = [
        {
          path: '/src/foo.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 5,
          analyzedAt: now,
          repoRoot: '/test/repo',
        },
        {
          path: '/src/foo.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 7,
          analyzedAt: now + 1000,
          repoRoot: '/test/repo',
        },
        {
          path: '/src/foo.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 9,
          analyzedAt: now + 2000,
          repoRoot: '/test/repo',
        },
      ];

      for (const analysis of analyses) {
        cache.save(analysis);
      }

      const history = cache.getRatingHistory('/src/foo.ts', '/test/repo');

      expect(history.length).toBe(3);
      expect(history[0].rating).toBe(9); // Most recent first
      expect(history[1].rating).toBe(7);
      expect(history[2].rating).toBe(5);
    });

    it('should limit history to specified count', () => {
      const now = Date.now();
      for (let i = 0; i < 30; i++) {
        cache.save({
          path: '/src/foo.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: i,
          analyzedAt: now + i * 1000,
          repoRoot: '/test/repo',
        });
      }

      const history = cache.getRatingHistory('/src/foo.ts', '/test/repo', 10);

      expect(history.length).toBe(10);
    });

    it('should return empty array for non-existent file', () => {
      const history = cache.getRatingHistory('/nonexistent.ts', '/test/repo');
      expect(history.length).toBe(0);
    });
  });

  describe('getOverallRating', () => {
    it('should return average rating for repo', () => {
      const analyses: FileAnalysis[] = [
        {
          path: '/src/a.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 8,
          analyzedAt: Date.now(),
          repoRoot: '/test/repo',
        },
        {
          path: '/src/b.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 50, cyclomaticComplexity: 3, numberOfMethods: 5, numberOfClasses: 1, importCount: 2 },
          violations: [],
          rating: 6,
          analyzedAt: Date.now(),
          repoRoot: '/test/repo',
        },
        {
          path: '/src/c.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 75, cyclomaticComplexity: 4, numberOfMethods: 7, numberOfClasses: 1, importCount: 3 },
          violations: [],
          rating: 10,
          analyzedAt: Date.now(),
          repoRoot: '/test/repo',
        },
      ];

      for (const analysis of analyses) {
        cache.save(analysis);
      }

      const overall = cache.getOverallRating('/test/repo');

      expect(overall).toBe(8);
    });

    it('should return 10 for empty repo', () => {
      const overall = cache.getOverallRating('/empty/repo');
      expect(overall).toBe(10);
    });
  });

  describe('node positions', () => {
    it('should save and retrieve node position', () => {
      cache.saveNodePosition('/test/repo', 'node-a', 100, 200);

      const positions = cache.getNodePositions('/test/repo');

      expect(positions.length).toBe(1);
      expect(positions[0].nodeId).toBe('node-a');
      expect(positions[0].x).toBe(100);
      expect(positions[0].y).toBe(200);
    });

    it('should update existing node position', () => {
      cache.saveNodePosition('/test/repo', 'node-a', 100, 200);
      cache.saveNodePosition('/test/repo', 'node-a', 150, 250);

      const positions = cache.getNodePositions('/test/repo');

      expect(positions.length).toBe(1);
      expect(positions[0].x).toBe(150);
      expect(positions[0].y).toBe(250);
    });

    it('should return positions for multiple nodes', () => {
      cache.saveNodePosition('/test/repo', 'node-a', 100, 200);
      cache.saveNodePosition('/test/repo', 'node-b', 300, 400);
      cache.saveNodePosition('/test/repo', 'node-c', 500, 600);

      const positions = cache.getNodePositions('/test/repo');

      expect(positions.length).toBe(3);
    });

    it('should return empty array for repo with no positions', () => {
      const positions = cache.getNodePositions('/empty/repo');
      expect(positions.length).toBe(0);
    });
  });

  describe('clearRepo', () => {
    it('should delete all analyses for repo', () => {
      const analyses: FileAnalysis[] = [
        {
          path: '/src/a.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 8,
          analyzedAt: Date.now(),
          repoRoot: '/test/repo',
        },
        {
          path: '/src/b.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 50, cyclomaticComplexity: 3, numberOfMethods: 5, numberOfClasses: 1, importCount: 2 },
          violations: [],
          rating: 6,
          analyzedAt: Date.now(),
          repoRoot: '/test/repo',
        },
      ];

      for (const analysis of analyses) {
        cache.save(analysis);
      }

      const deleted = cache.clearRepo('/test/repo');

      expect(deleted).toBe(2);
      expect(cache.getAll('/test/repo').length).toBe(0);
    });

    it('should delete rating history for repo', () => {
      const analysis: FileAnalysis = {
        path: '/src/foo.ts',
        language: 'typescript',
        dependencies: [],
        metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
        violations: [],
        rating: 8,
        analyzedAt: Date.now(),
        repoRoot: '/test/repo',
      };

      cache.save(analysis);
      cache.save({ ...analysis, rating: 9, analyzedAt: Date.now() + 1000 });

      cache.clearRepo('/test/repo');

      const history = cache.getRatingHistory('/src/foo.ts', '/test/repo');
      expect(history.length).toBe(0);
    });

    it('should delete node positions for repo', () => {
      cache.saveNodePosition('/test/repo', 'node-a', 100, 200);
      cache.saveNodePosition('/test/repo', 'node-b', 300, 400);

      cache.clearRepo('/test/repo');

      const positions = cache.getNodePositions('/test/repo');
      expect(positions.length).toBe(0);
    });

    it('should not affect other repos', () => {
      const analysis1: FileAnalysis = {
        path: '/src/a.ts',
        language: 'typescript',
        dependencies: [],
        metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
        violations: [],
        rating: 8,
        analyzedAt: Date.now(),
        repoRoot: '/repo1',
      };

      const analysis2: FileAnalysis = {
        path: '/src/b.ts',
        language: 'typescript',
        dependencies: [],
        metrics: { linesOfCode: 50, cyclomaticComplexity: 3, numberOfMethods: 5, numberOfClasses: 1, importCount: 2 },
        violations: [],
        rating: 6,
        analyzedAt: Date.now(),
        repoRoot: '/repo2',
      };

      cache.save(analysis1);
      cache.save(analysis2);

      cache.clearRepo('/repo1');

      expect(cache.getAll('/repo1').length).toBe(0);
      expect(cache.getAll('/repo2').length).toBe(1);
    });
  });

  describe('repository management', () => {
    describe('saveRepository', () => {
      it('should save new repository', () => {
        const repo: RepoMetadata = {
          id: 'repo-123',
          path: '/test/repo',
          name: 'Test Repo',
          sessionId: 'session-abc',
          sessionType: 'claude',
          createdAt: Date.now(),
          isActive: true,
        };

        cache.saveRepository(repo);

        const retrieved = cache.getRepository('repo-123');

        expect(retrieved).not.toBeNull();
        expect(retrieved?.name).toBe('Test Repo');
        expect(retrieved?.sessionId).toBe('session-abc');
      });

      it('should update existing repository', () => {
        const repo1: RepoMetadata = {
          id: 'repo-123',
          path: '/test/repo',
          name: 'Original Name',
          sessionId: 'session-abc',
          sessionType: 'claude',
          createdAt: Date.now(),
          isActive: true,
        };

        const repo2: RepoMetadata = {
          ...repo1,
          name: 'Updated Name',
          createdAt: Date.now() + 1000,
        };

        cache.saveRepository(repo1);
        cache.saveRepository(repo2);

        const retrieved = cache.getRepository('repo-123');

        expect(retrieved?.name).toBe('Updated Name');
        expect(retrieved?.createdAt).toBe(repo1.createdAt); // Preserved on conflict
      });

      it('should handle missing sessionId', () => {
        const repo: RepoMetadata = {
          id: 'repo-456',
          path: '/test/repo2',
          name: 'Repo Without Session',
          sessionType: 'unknown',
          createdAt: Date.now(),
          isActive: true,
        };

        cache.saveRepository(repo);

        const retrieved = cache.getRepository('repo-456');

        expect(retrieved).not.toBeNull();
        expect(retrieved?.sessionId).toBeUndefined();
      });
    });

    describe('getRepository', () => {
      it('should return null for non-existent repo', () => {
        const retrieved = cache.getRepository('nonexistent-id');
        expect(retrieved).toBeNull();
      });
    });

    describe('getRepositoryByPath', () => {
      it('should find repo by path', () => {
        const repo: RepoMetadata = {
          id: 'repo-789',
          path: '/unique/path/to/repo',
          name: 'Path Repo',
          sessionType: 'unknown',
          createdAt: Date.now(),
          isActive: true,
        };

        cache.saveRepository(repo);

        const retrieved = cache.getRepositoryByPath('/unique/path/to/repo');

        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe('repo-789');
      });

      it('should return null for non-existent path', () => {
        const retrieved = cache.getRepositoryByPath('/nonexistent/path');
        expect(retrieved).toBeNull();
      });
    });

    describe('getAllRepositories', () => {
      it('should return all repositories', () => {
        const repos: RepoMetadata[] = [
          {
            id: 'repo-1',
            path: '/repo/1',
            name: 'Repo 1',
            sessionType: 'claude',
            createdAt: Date.now(),
            isActive: true,
          },
          {
            id: 'repo-2',
            path: '/repo/2',
            name: 'Repo 2',
            sessionType: 'github-copilot',
            createdAt: Date.now(),
            isActive: true,
          },
        ];

        for (const repo of repos) {
          cache.saveRepository(repo);
        }

        const all = cache.getAllRepositories();

        expect(all.length).toBe(2);
      });

      it('should filter to active only when requested', () => {
        const repos: RepoMetadata[] = [
          {
            id: 'active-repo',
            path: '/active/repo',
            name: 'Active Repo',
            sessionType: 'claude',
            createdAt: Date.now(),
            isActive: true,
          },
          {
            id: 'inactive-repo',
            path: '/inactive/repo',
            name: 'Inactive Repo',
            sessionType: 'claude',
            createdAt: Date.now(),
            isActive: false,
          },
        ];

        for (const repo of repos) {
          cache.saveRepository(repo);
        }

        const active = cache.getAllRepositories(true);

        expect(active.length).toBe(1);
        expect(active[0].id).toBe('active-repo');
      });
    });

    describe('getRepositoriesBySession', () => {
      it('should return repos for session', () => {
        const repos: RepoMetadata[] = [
          {
            id: 'repo-1',
            path: '/repo/1',
            name: 'Session Repo 1',
            sessionId: 'session-123',
            sessionType: 'claude',
            createdAt: Date.now(),
            isActive: true,
          },
          {
            id: 'repo-2',
            path: '/repo/2',
            name: 'Session Repo 2',
            sessionId: 'session-123',
            sessionType: 'claude',
            createdAt: Date.now(),
            isActive: true,
          },
          {
            id: 'repo-3',
            path: '/repo/3',
            name: 'Other Session Repo',
            sessionId: 'session-456',
            sessionType: 'claude',
            createdAt: Date.now(),
            isActive: true,
          },
        ];

        for (const repo of repos) {
          cache.saveRepository(repo);
        }

        const sessionRepos = cache.getRepositoriesBySession('session-123');

        expect(sessionRepos.length).toBe(2);
      });

      it('should return empty array for non-existent session', () => {
        const repos = cache.getRepositoriesBySession('nonexistent-session');
        expect(repos.length).toBe(0);
      });
    });

    describe('updateRepositoryStats', () => {
      it('should update file count and rating', () => {
        const repo: RepoMetadata = {
          id: 'repo-stats',
          path: '/stats/repo',
          name: 'Stats Repo',
          sessionType: 'claude',
          createdAt: Date.now(),
          fileCount: 10,
          overallRating: 7,
          isActive: true,
        };

        cache.saveRepository(repo);

        cache.updateRepositoryStats('repo-stats', 50, 8.5);

        const updated = cache.getRepository('repo-stats');

        expect(updated?.fileCount).toBe(50);
        expect(updated?.overallRating).toBe(8.5);
        expect(updated?.lastAnalyzedAt).toBeDefined();
      });
    });

    describe('deleteRepository', () => {
      it('should delete repository', () => {
        const repo: RepoMetadata = {
          id: 'repo-delete',
          path: '/delete/repo',
          name: 'Delete Repo',
          sessionType: 'claude',
          createdAt: Date.now(),
          isActive: true,
        };

        cache.saveRepository(repo);

        const deleted = cache.deleteRepository('repo-delete');

        expect(deleted).toBe(1);
        expect(cache.getRepository('repo-delete')).toBeNull();
      });

      it('should clear associated analyses', () => {
        const repo: RepoMetadata = {
          id: 'repo-delete-with-data',
          path: '/delete/data/repo',
          name: 'Delete Data Repo',
          sessionType: 'claude',
          createdAt: Date.now(),
          isActive: true,
        };

        cache.saveRepository(repo);
        cache.save({
          path: '/src/foo.ts',
          language: 'typescript',
          dependencies: [],
          metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 10, numberOfClasses: 2, importCount: 5 },
          violations: [],
          rating: 8,
          analyzedAt: Date.now(),
          repoRoot: '/delete/data/repo',
        });

        cache.deleteRepository('repo-delete-with-data');

        expect(cache.getAll('/delete/data/repo').length).toBe(0);
      });

      it('should return 0 for non-existent repo', () => {
        const deleted = cache.deleteRepository('nonexistent-repo');
        expect(deleted).toBe(0);
      });
    });
  });

  describe('exclude patterns', () => {
    describe('getExcludePatterns', () => {
      it('should return empty array for repo with no patterns', () => {
        const patterns = cache.getExcludePatterns('/test/repo');
        expect(patterns.length).toBe(0);
      });
    });

    describe('addExcludePattern', () => {
      it('should add new pattern', () => {
        const id = cache.addExcludePattern('/test/repo', '**/*.test.ts', 'Test files');

        expect(id).toBeGreaterThan(0);

        const patterns = cache.getExcludePatterns('/test/repo');

        expect(patterns.length).toBe(1);
        expect(patterns[0].pattern).toBe('**/*.test.ts');
        expect(patterns[0].label).toBe('Test files');
      });

      it('should handle pattern without label', () => {
        const id = cache.addExcludePattern('/test/repo', '**/*.spec.ts');

        expect(id).toBeGreaterThan(0);

        const patterns = cache.getExcludePatterns('/test/repo');

        expect(patterns.length).toBe(1);
        expect(patterns[0].label).toBeNull();
      });

      it('should not add duplicate pattern', () => {
        cache.addExcludePattern('/test/repo', '**/*.test.ts', 'First');
        const id = cache.addExcludePattern('/test/repo', '**/*.test.ts', 'Second');

        // Duplicate pattern is ignored (may return 0 or same id depending on SQLite behavior)
        // The key test is that only one pattern exists
        const patterns = cache.getExcludePatterns('/test/repo');

        expect(patterns.length).toBe(1);
        expect(patterns[0].label).toBe('First');
      });
    });

    describe('removeExcludePattern', () => {
      it('should remove pattern by id', () => {
        const id = cache.addExcludePattern('/test/repo', '**/*.test.ts');

        const removed = cache.removeExcludePattern(id);

        expect(removed).toBe(true);

        const patterns = cache.getExcludePatterns('/test/repo');
        expect(patterns.length).toBe(0);
      });

      it('should return false for non-existent id', () => {
        const removed = cache.removeExcludePattern(99999);
        expect(removed).toBe(false);
      });
    });
  });

  describe('constructor migrations', () => {
    it('should create tables on first run', () => {
      // Tables are created in constructor - if we got here without error, test passes
      expect(cache).toBeDefined();
    });

    it('should handle existing database', () => {
      // Create a new cache instance with the same db path
      const cache2 = new SqliteCache(testDbPath);

      // Should work without errors
      expect(cache2).toBeDefined();

      cache2.close();
    });
  });
});
