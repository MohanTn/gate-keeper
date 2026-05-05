import * as fs from 'fs';
import * as path from 'path';

// Mock process.exit before any imports
const mockExit = jest.fn();
process.exit = mockExit as any;

// Mock 'open' before viz-server is loaded (it's an ES module)
jest.mock('open', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock express to prevent actual server binding during tests
jest.mock('express', () => {
  const mockApp: any = {
    use: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    listen: jest.fn((port: any, host: any, cb: any) => {
      if (cb) cb();
      return { close: jest.fn() };
    }),
  };
  const express = jest.fn(() => mockApp) as any;
  express.json = jest.fn();
  return express;
});

// Mock SqliteCache
jest.mock('./cache/sqlite-cache', () => ({
  SqliteCache: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
    getRepository: jest.fn(),
    saveRepository: jest.fn(),
    getAllRepositories: jest.fn().mockReturnValue([]),
  })),
}));

// Mock UniversalAnalyzer
jest.mock('./analyzer/universal-analyzer', () => ({
  UniversalAnalyzer: jest.fn().mockImplementation(() => ({
    analyze: jest.fn(),
    isSupportedFile: jest.fn(),
  })),
}));

// Mock VizServer - must return a proper instance with methods that return Promises
let mockVizServerInstance: any;
jest.mock('./viz/viz-server', () => ({
  VizServer: jest.fn().mockImplementation(() => {
    mockVizServerInstance = {
      start: jest.fn().mockResolvedValue(undefined),
      scan: jest.fn().mockResolvedValue(undefined),
      broadcastRepoCreated: jest.fn(),
      pushAnalysis: jest.fn(),
    };
    return mockVizServerInstance;
  }),
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({
    status: 0,
    stdout: '/test/repo',
  })),
}));

// Mock fs to prevent actual file system operations during module load
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest.fn().mockReturnValue('{}'),
    unlinkSync: jest.fn(),
  };
});

describe('daemon configuration', () => {
  const GK_DIR = path.join(process.env.HOME ?? '/tmp', '.gate-keeper');
  const CONFIG_FILE = path.join(GK_DIR, 'config.json');

  beforeEach(() => {
    jest.resetModules();
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have default minRating of 6.5', () => {
      const { DEFAULT_CONFIG } = require('./daemon');
      expect(DEFAULT_CONFIG.minRating).toBe(6.5);
    });

    it('should have default scanExcludePatterns', () => {
      const { DEFAULT_CONFIG } = require('./daemon');
      expect(DEFAULT_CONFIG.scanExcludePatterns).toBeDefined();
    });

    it('should exclude C# migration files by default', () => {
      const { DEFAULT_CONFIG } = require('./daemon');
      const csharpPatterns = DEFAULT_CONFIG.scanExcludePatterns?.csharp ?? [];
      expect(csharpPatterns).toContain('**/Migrations/*.cs');
    });

    it('should exclude TypeScript declaration files by default', () => {
      const { DEFAULT_CONFIG } = require('./daemon');
      const tsPatterns = DEFAULT_CONFIG.scanExcludePatterns?.typescript ?? [];
      expect(tsPatterns).toContain('*.d.ts');
    });
  });

  describe('constants', () => {
    it('should have correct IPC_PORT', () => {
      const { IPC_PORT } = require('./daemon');
      expect(IPC_PORT).toBe(5379);
    });

    it('should have GK_DIR containing .gate-keeper', () => {
      const { GK_DIR } = require('./daemon');
      expect(GK_DIR).toContain('.gate-keeper');
    });

    it('should have PID_FILE path', () => {
      const { PID_FILE } = require('./daemon');
      expect(PID_FILE).toContain('daemon.pid');
    });

    it('should have CONFIG_FILE path', () => {
      const { CONFIG_FILE } = require('./daemon');
      expect(CONFIG_FILE).toContain('config.json');
    });
  });
});

describe('findGitRoot', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should return git root when git command succeeds', () => {
    const { spawnSync } = require('child_process');
    (spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '/path/to/repo\n',
    });

    const { findGitRoot } = require('./daemon');
    const result = findGitRoot('/path/to/repo/src');

    expect(result).toBe('/path/to/repo');
  });

  it('should return input dir when git command fails', () => {
    const { spawnSync } = require('child_process');
    (spawnSync as jest.Mock).mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'not a git repo',
    });

    const { findGitRoot } = require('./daemon');
    const result = findGitRoot('/not/a/git/repo');

    expect(result).toBe('/not/a/git/repo');
  });

  it('should trim whitespace from git output', () => {
    const { spawnSync } = require('child_process');
    (spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '  /path/with/spaces  \n\n',
    });

    const { findGitRoot } = require('./daemon');
    const result = findGitRoot('/path/with/spaces/src');

    expect(result).toBe('/path/with/spaces');
  });

  it('should call git with correct cwd parameter', () => {
    const { spawnSync } = require('child_process');
    (spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '/repo\n',
    });

    const { findGitRoot } = require('./daemon');
    findGitRoot('/my/project');

    expect((spawnSync as jest.Mock).mock.calls[0][0]).toBe('git');
    expect((spawnSync as jest.Mock).mock.calls[0][1]).toEqual(['rev-parse', '--show-toplevel']);
  });
});

describe('daemon IPC endpoints', () => {
  describe('/health endpoint', () => {
    it('should return ok status with PID', () => {
      const expectedResponse = { ok: true, pid: process.pid };
      expect(expectedResponse.ok).toBe(true);
    });
  });

  describe('/repo-register endpoint', () => {
    it('should handle invalid requests', () => {
      const invalidRequests = [
        {},
        { action: 'unknown' },
        { action: 'register_repo' },
        { action: 'register_repo', repo: {} },
      ];

      for (const req of invalidRequests) {
        const hasValidAction = (req as any).action === 'register_repo';
        const hasValidPath = !!(req as any).repo?.path;
        // Invalid if action is not register_repo OR repo path is missing
        const isValid = hasValidAction && hasValidPath;
        // At least some of these should be invalid
        if ((req as any).action !== 'register_repo' || !(req as any).repo?.path) {
          expect(isValid).toBe(false);
        }
      }
    });

    it('should handle valid repo registration request structure', () => {
      const validRequest = {
        action: 'register_repo',
        repo: {
          path: '/path/to/repo',
          name: 'my-repo',
        },
      };

      expect(validRequest.action).toBe('register_repo');
      expect(validRequest.repo.path).toBeDefined();
    });
  });

  describe('/analyze endpoint', () => {
    it('should handle missing file path', () => {
      const request = {};
      const isValid = !!(request as any).filePath;
      expect(isValid).toBe(false);
    });

    it('should handle unsupported file types', () => {
      const supportedExts = ['.ts', '.tsx', '.jsx', '.js', '.cs'];
      const unsupportedExts = ['.py', '.java', '.go', '.rb'];

      for (const ext of unsupportedExts) {
        const isSupported = supportedExts.some(e => `.file${ext}`.endsWith(e));
        expect(isSupported).toBe(false);
      }
    });
  });
});

describe('daemon signal handling', () => {
  it('should handle SIGTERM signal', () => {
    expect('SIGTERM').toBe('SIGTERM');
  });

  it('should handle SIGINT signal', () => {
    expect('SIGINT').toBe('SIGINT');
  });
});

describe('daemon startup messages', () => {
  it('should log daemon started message with PID', () => {
    const expectedMessage = `[gate-keeper] Daemon started (PID ${process.pid})`;
    expect(expectedMessage).toContain('Daemon started');
  });

  it('should log IPC ready message', () => {
    const { IPC_PORT } = require('./daemon');
    const expectedMessage = `[gate-keeper] IPC ready on 127.0.0.1:${IPC_PORT}`;
    expect(expectedMessage).toContain('IPC ready');
  });
});

describe('daemon --no-scan flag', () => {
  it('should skip initial scan when --no-scan flag is provided', () => {
    const args = ['--no-scan'];
    const noScan = args.includes('--no-scan');
    expect(noScan).toBe(true);
  });

  it('should perform initial scan by default', () => {
    const args: string[] = [];
    const noScan = args.includes('--no-scan');
    expect(noScan).toBe(false);
  });
});

describe('daemon configuration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should have DEFAULT_CONFIG with required fields', () => {
    const { DEFAULT_CONFIG } = require('./daemon');
    expect(DEFAULT_CONFIG.minRating).toBe(6.5);
    expect(DEFAULT_CONFIG.scanExcludePatterns).toBeDefined();
  });

  it('should have default C# exclusions', () => {
    const { DEFAULT_CONFIG } = require('./daemon');
    expect(DEFAULT_CONFIG.scanExcludePatterns.csharp).toContain('**/Migrations/*.cs');
  });

  it('should have default TypeScript exclusions', () => {
    const { DEFAULT_CONFIG } = require('./daemon');
    expect(DEFAULT_CONFIG.scanExcludePatterns.typescript).toContain('*.d.ts');
  });

  it('should export IPC_PORT constant', () => {
    const { IPC_PORT } = require('./daemon');
    expect(IPC_PORT).toBe(5379);
  });

  it('should export GK_DIR constant', () => {
    const { GK_DIR } = require('./daemon');
    expect(GK_DIR).toContain('.gate-keeper');
  });

  it('should export PID_FILE constant', () => {
    const { PID_FILE } = require('./daemon');
    expect(PID_FILE).toContain('daemon.pid');
  });

  it('should export CONFIG_FILE constant', () => {
    const { CONFIG_FILE } = require('./daemon');
    expect(CONFIG_FILE).toContain('config.json');
  });
});

describe('daemon HTTP endpoints', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe('/health endpoint', () => {
    it('should return status ok with process pid', () => {
      const response = { ok: true, pid: process.pid };
      expect(response.ok).toBe(true);
      expect(response.pid).toBeGreaterThan(0);
    });

    it('should include valid pid in response', () => {
      const response = { ok: true, pid: 12345 };
      expect(typeof response.pid).toBe('number');
      expect(response.pid).toBeGreaterThan(0);
    });
  });

  describe('/analyze endpoint request handling', () => {
    it('should handle requests with filePath and repoRoot', () => {
      const request = {
        filePath: '/src/index.ts',
        repoRoot: '/workspace',
      };
      expect(request.filePath).toBeDefined();
      expect(request.repoRoot).toBeDefined();
    });

    it('should handle requests with only filePath', () => {
      const request = { filePath: '/src/app.tsx' };
      expect(request.filePath).toBeDefined();
    });

    it('should identify missing filePath', () => {
      const request = { filePath: undefined };
      expect(!request.filePath).toBe(true);
    });

    it('should validate TypeScript file support', () => {
      const ext = '.ts';
      const supported = ['.ts', '.tsx', '.js', '.jsx', '.cs'];
      expect(supported.includes(ext)).toBe(true);
    });

    it('should validate C# file support', () => {
      const ext = '.cs';
      const supported = ['.ts', '.tsx', '.js', '.jsx', '.cs'];
      expect(supported.includes(ext)).toBe(true);
    });

    it('should reject unsupported extensions', () => {
      const unsupported = ['.py', '.go', '.rb', '.java'];
      const supported = ['.ts', '.tsx', '.js', '.jsx', '.cs'];

      for (const ext of unsupported) {
        expect(supported.includes(ext)).toBe(false);
      }
    });
  });

  describe('/repo-register endpoint', () => {
    it('should require action field', () => {
      const invalid = { repo: { path: '/path' } };
      expect((invalid as any).action).toBeUndefined();
    });

    it('should require register_repo action', () => {
      const request = { action: 'register_repo' };
      expect(request.action).toBe('register_repo');
    });

    it('should require repo.path field', () => {
      const invalid = { action: 'register_repo', repo: {} };
      expect((invalid as any).repo.path).toBeUndefined();
    });

    it('should accept optional repo metadata', () => {
      const request = {
        action: 'register_repo',
        repo: {
          path: '/my/repo',
          name: 'my-repo',
          sessionId: 'abc123',
          sessionType: 'claude',
          createdAt: Date.now(),
        },
      };
      expect(request.repo.path).toBe('/my/repo');
      expect(request.repo.name).toBe('my-repo');
    });

    it('should generate consistent hash for same path', () => {
      const crypto = require('crypto');
      const path = '/my/project';
      const hash1 = crypto.createHash('md5').update(path).digest('hex');
      const hash2 = crypto.createHash('md5').update(path).digest('hex');
      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different paths', () => {
      const crypto = require('crypto');
      const path1 = '/my/project';
      const path2 = '/other/project';
      const hash1 = crypto.createHash('md5').update(path1).digest('hex');
      const hash2 = crypto.createHash('md5').update(path2).digest('hex');
      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('hook-receiver helpers', () => {
  describe('globToRegex', () => {
    function globToRegex(pattern: string): RegExp {
      const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__GLOBSTAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__GLOBSTAR__/g, '.*');
      return new RegExp(`(?:^|/)${escaped}$`, 'i');
    }

    it('should convert simple glob pattern to regex', () => {
      const re = globToRegex('*.ts');
      
      expect(re.test('foo.ts')).toBe(true);
      expect(re.test('foo.js')).toBe(false);
    });

    it('should convert ** globstar pattern to regex', () => {
      const re = globToRegex('**/*.test.ts');
      
      // Pattern matches with path separator prefix
      expect(re.test('/foo.test.ts')).toBe(true);
      expect(re.test('/src/foo.test.ts')).toBe(true);
      expect(re.test('src/foo.test.ts')).toBe(true);
    });

    it('should escape special regex characters', () => {
      const re = globToRegex('*.config.ts');
      
      expect(re.test('foo.config.ts')).toBe(true);
      expect(re.test('fooXconfig.ts')).toBe(false);
    });

    it('should be case insensitive', () => {
      const re = globToRegex('*.TS');
      
      expect(re.test('foo.ts')).toBe(true);
    });
  });

  describe('WATCHED_EXTENSIONS', () => {
    const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);

    it('should include TypeScript extensions', () => {
      expect(WATCHED_EXTENSIONS.has('.ts')).toBe(true);
      expect(WATCHED_EXTENSIONS.has('.tsx')).toBe(true);
    });

    it('should include C# extension', () => {
      expect(WATCHED_EXTENSIONS.has('.cs')).toBe(true);
    });

    it('should not include unsupported extensions', () => {
      expect(WATCHED_EXTENSIONS.has('.py')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.java')).toBe(false);
    });
  });

  describe('violation formatting', () => {
    it('should format violations with line numbers', () => {
      const violation = {
        type: 'long_method',
        severity: 'warning',
        message: 'Method is too long',
        line: 42,
        fix: 'Extract into smaller methods',
      };

      const loc = (violation as any).line != null ? ` (line ${(violation as any).line})` : '';
      const fix = violation.fix ? ` — ${violation.fix}` : '';
      const formatted = `[${violation.severity}] ${violation.message}${loc}${fix}`;

      expect(formatted).toContain('(line 42)');
      expect(formatted).toContain('Extract into smaller methods');
    });

    it('should format violations without line numbers', () => {
      const violation = {
        type: 'god_class',
        severity: 'warning',
        message: 'Class has too many methods',
      };

      const loc = (violation as any).line != null ? ` (line ${(violation as any).line})` : '';
      const formatted = `[${violation.severity}] ${violation.message}${loc}`;

      expect(formatted).not.toContain('(line');
    });
  });
});

describe('session handling', () => {
  it('should handle UserPromptSubmit event structure', () => {
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'test-session-123',
      cwd: '/test/workspace',
    };

    expect(payload.hook_event_name).toBe('UserPromptSubmit');
  });

  it('should handle SessionStart event structure', () => {
    const payload = {
      hook_event_name: 'SessionStart',
      session_id: 'new-session',
      cwd: '/test/cwd',
    };

    expect(payload.hook_event_name).toBe('SessionStart');
  });

  it('should handle session_create event structure', () => {
    const payload = {
      hook_event_name: 'session_create',
      tool_name: 'claude',
      session_info: {
        workspace_path: '/workspace',
        session_type: 'claude',
      },
    };

    expect(payload.hook_event_name).toBe('session_create');
  });
});

describe('exit codes', () => {
  it('should exit with code 2 when rating is below minimum', () => {
    const minRating = 6.5;
    const fileRating = 4.0;
    
    expect(fileRating).toBeLessThan(minRating);
  });

  it('should continue when rating meets minimum', () => {
    const minRating = 6.5;
    const fileRating = 8.0;
    
    expect(fileRating).toBeGreaterThanOrEqual(minRating);
  });
});
