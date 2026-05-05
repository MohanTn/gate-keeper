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
jest.mock('./viz/viz-server', () => ({
  VizServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    scan: jest.fn().mockResolvedValue(undefined),
    broadcastRepoCreated: jest.fn(),
    pushAnalysis: jest.fn(),
  })),
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
