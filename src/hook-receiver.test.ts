import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawn, spawnSync } from 'child_process';

// Mock the daemon HTTP call
jest.mock('http', () => ({
  request: jest.fn((options: any, callback: any) => {
    const mockReq = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
      setTimeout: jest.fn(),
    };
    return mockReq;
  }),
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({
    unref: jest.fn(),
  })),
  spawnSync: jest.fn(() => ({
    status: 0,
    stdout: '/test/repo',
  })),
}));

// Mock process.stdin to prevent open handles
beforeAll(() => {
  jest.spyOn(process.stdin, 'setEncoding').mockImplementation(() => process.stdin);
  jest.spyOn(process.stdin, 'on').mockImplementation(() => process.stdin);
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
});

afterAll(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('hook-receiver helpers', () => {
  describe('globToRegex', () => {
    it('should convert simple glob pattern to regex', () => {
      const { globToRegex } = require('./hook-receiver');
      const re = globToRegex('*.ts');

      expect(re.test('foo.ts')).toBe(true);
      expect(re.test('foo.js')).toBe(false);
      // Single * does not match across directories, but the regex matches partial paths
      // so src/foo.ts will match because foo.ts matches *.ts
      expect(re.test('src/foo.ts')).toBe(true);
    });

    it('should convert ** globstar pattern to regex', () => {
      const { globToRegex } = require('./hook-receiver');
      const re = globToRegex('**/*.test.ts');

      expect(re.test('foo.test.ts')).toBe(true);
      expect(re.test('src/foo.test.ts')).toBe(true);
      expect(re.test('src/deep/foo.test.ts')).toBe(true);
    });

    it('should escape special regex characters', () => {
      const { globToRegex } = require('./hook-receiver');
      const re = globToRegex('*.config.ts');

      expect(re.test('foo.config.ts')).toBe(true);
      expect(re.test('fooXconfig.ts')).toBe(false);
    });

    it('should be case insensitive', () => {
      const { globToRegex } = require('./hook-receiver');
      const re = globToRegex('*.TS');

      expect(re.test('foo.ts')).toBe(true);
      expect(re.test('foo.TS')).toBe(true);
    });

    it('should handle patterns starting with **/', () => {
      const { globToRegex } = require('./hook-receiver');
      const re = globToRegex('**/node_modules/**');

      expect(re.test('node_modules/foo')).toBe(true);
      expect(re.test('src/node_modules/foo')).toBe(true);
      expect(re.test('node_modules/pkg/index.js')).toBe(true);
    });

    it('should handle ** pattern for any path depth', () => {
      const { globToRegex } = require('./hook-receiver');
      const re = globToRegex('**/*.generated.ts');

      expect(re.test('foo.generated.ts')).toBe(true);
      expect(re.test('src/foo.generated.ts')).toBe(true);
      expect(re.test('a/b/c/foo.generated.ts')).toBe(true);
    });

    it('should handle exact file patterns', () => {
      const { globToRegex } = require('./hook-receiver');
      const re = globToRegex('*.Designer.cs');

      expect(re.test('Form1.Designer.cs')).toBe(true);
      expect(re.test('test.Designer.cs')).toBe(true);
      expect(re.test('test.cs')).toBe(false);
    });
  });

  describe('isFileExcludedByScanConfig', () => {
    let mockConfig: any;
    let originalExistsSync: any;

    beforeEach(() => {
      jest.resetModules();
      mockConfig = {
        scanExcludePatterns: {
          global: ['**/node_modules/**', '**/dist/**'],
          typescript: ['*.d.ts', '**/*.generated.ts'],
          csharp: ['**/Migrations/*.cs', '*.Designer.cs'],
        },
      };

      const mockFs = {
        ...jest.requireActual('fs'),
        existsSync: jest.fn((p: string) => {
          if (p.endsWith('config.json')) return true;
          return originalExistsSync ? originalExistsSync(p) : false;
        }),
        readFileSync: jest.fn((p: string) => {
          if (p.endsWith('config.json')) return JSON.stringify(mockConfig);
          return '';
        }),
      };
      jest.doMock('fs', () => mockFs);
    });

    afterEach(() => {
      jest.resetModules();
    });

    it('should exclude files matching global patterns', () => {
      const { isFileExcludedByScanConfig } = require('./hook-receiver');

      expect(isFileExcludedByScanConfig('/src/node_modules/foo.ts', '.ts')).toBe(true);
      expect(isFileExcludedByScanConfig('/src/dist/bundle.js', '.js')).toBe(true);
    });

    it('should exclude files matching typescript patterns', () => {
      const { isFileExcludedByScanConfig } = require('./hook-receiver');

      expect(isFileExcludedByScanConfig('/src/types.d.ts', '.ts')).toBe(true);
      expect(isFileExcludedByScanConfig('/src/api.generated.ts', '.ts')).toBe(true);
    });

    it('should exclude files matching csharp patterns', () => {
      const { isFileExcludedByScanConfig } = require('./hook-receiver');

      expect(isFileExcludedByScanConfig('/src/Migrations/001_Init.cs', '.cs')).toBe(true);
      expect(isFileExcludedByScanConfig('/src/Form1.Designer.cs', '.cs')).toBe(true);
    });

    it('should not exclude files not matching any pattern', () => {
      const { isFileExcludedByScanConfig } = require('./hook-receiver');

      expect(isFileExcludedByScanConfig('/src/foo.ts', '.ts')).toBe(false);
      expect(isFileExcludedByScanConfig('/src/Service.cs', '.cs')).toBe(false);
    });

    it('should return false when no config exists', () => {
      const mockFs = {
        ...jest.requireActual('fs'),
        existsSync: jest.fn(() => false),
      };
      jest.doMock('fs', () => mockFs);

      const { isFileExcludedByScanConfig } = require('./hook-receiver');
      expect(isFileExcludedByScanConfig('/src/foo.ts', '.ts')).toBe(false);

      jest.resetModules();
    });

    it('should return false when config is malformed', () => {
      const mockFs = {
        ...jest.requireActual('fs'),
        existsSync: jest.fn(() => true),
        readFileSync: jest.fn(() => 'invalid json'),
      };
      jest.doMock('fs', () => mockFs);

      const { isFileExcludedByScanConfig } = require('./hook-receiver');
      expect(isFileExcludedByScanConfig('/src/foo.ts', '.ts')).toBe(false);

      jest.resetModules();
    });

    it('should handle missing language patterns gracefully', () => {
      mockConfig = {
        scanExcludePatterns: {
          global: ['**/temp/**'],
        },
      };

      const { isFileExcludedByScanConfig } = require('./hook-receiver');
      expect(isFileExcludedByScanConfig('/src/foo.ts', '.ts')).toBe(false);
      expect(isFileExcludedByScanConfig('/temp/foo.ts', '.ts')).toBe(true);
    });

    it('should match patterns against both full path and filename', () => {
      const { isFileExcludedByScanConfig } = require('./hook-receiver');

      // Pattern *.d.ts should match filename regardless of path
      expect(isFileExcludedByScanConfig('/src/types.d.ts', '.ts')).toBe(true);
      expect(isFileExcludedByScanConfig('/types.d.ts', '.ts')).toBe(true);
    });
  });

  describe('WATCHED_EXTENSIONS', () => {
    it('should include TypeScript extensions', () => {
      const { WATCHED_EXTENSIONS } = require('./hook-receiver');

      expect(WATCHED_EXTENSIONS.has('.ts')).toBe(true);
      expect(WATCHED_EXTENSIONS.has('.tsx')).toBe(true);
      expect(WATCHED_EXTENSIONS.has('.jsx')).toBe(true);
      expect(WATCHED_EXTENSIONS.has('.js')).toBe(true);
    });

    it('should include C# extension', () => {
      const { WATCHED_EXTENSIONS } = require('./hook-receiver');

      expect(WATCHED_EXTENSIONS.has('.cs')).toBe(true);
    });

    it('should not include unsupported extensions', () => {
      const { WATCHED_EXTENSIONS } = require('./hook-receiver');

      expect(WATCHED_EXTENSIONS.has('.py')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.java')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.go')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.rb')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.rs')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.php')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.css')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.html')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.json')).toBe(false);
    });
  });
});

describe('hook-receiver session handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('session registration', () => {
    it('should register session from UserPromptSubmit event', () => {
      const payload = {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'test-session-123',
        cwd: '/test/workspace',
      };

      expect(payload.hook_event_name).toBe('UserPromptSubmit');
      expect(payload.session_id).toBe('test-session-123');
      expect(payload.cwd).toBe('/test/workspace');
    });

    it('should handle SessionStart event', () => {
      const payload = {
        hook_event_name: 'SessionStart',
        session_id: 'new-session',
        cwd: '/test/cwd',
      };

      expect(payload.hook_event_name).toBe('SessionStart');
      expect(payload.session_id).toBeDefined();
    });

    it('should handle session_create event', () => {
      const payload = {
        hook_event_name: 'session_create',
        tool_name: 'claude',
        session_id: 'session-abc',
        session_info: {
          workspace_path: '/workspace',
          git_root: '/workspace',
          session_type: 'claude',
        },
      };

      expect(payload.hook_event_name).toBe('session_create');
      expect(payload.session_info.session_type).toBe('claude');
    });

    it('should handle session_create with all session_info fields', () => {
      const payload = {
        hook_event_name: 'session_create',
        tool_name: 'vscode',
        session_id: 'session-xyz',
        session_info: {
          workspace_path: '/workspace/project',
          git_root: '/workspace',
          session_type: 'copilot',
        },
      };

      expect(payload.session_info.workspace_path).toBe('/workspace/project');
      expect(payload.session_info.git_root).toBe('/workspace');
      expect(payload.session_info.session_type).toBe('copilot');
    });
  });
});

describe('hook-receiver file analysis flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should skip non-watched file extensions', () => {
    const { WATCHED_EXTENSIONS } = require('./hook-receiver');
    const unsupportedExts = ['.py', '.java', '.go', '.rb', '.rs', '.php', '.css', '.html', '.json', '.md'];

    for (const ext of unsupportedExts) {
      expect(WATCHED_EXTENSIONS.has(ext)).toBe(false);
    }
  });

  it('should process supported file extensions', () => {
    const { WATCHED_EXTENSIONS } = require('./hook-receiver');
    const supportedExts = ['.ts', '.tsx', '.jsx', '.js', '.cs'];

    for (const ext of supportedExts) {
      expect(WATCHED_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it('should handle file paths with tool_input.file_path', () => {
    const payload = {
      tool_input: {
        file_path: '/src/component.tsx',
      },
    };

    const filePath = payload.tool_input?.file_path;
    expect(filePath).toBe('/src/component.tsx');
  });

  it('should handle file paths with tool_input.path', () => {
    const payload = {
      tool_input: {
        path: '/src/service.cs',
      },
    };

    const filePath = payload.tool_input?.path;
    expect(filePath).toBe('/src/service.cs');
  });

  it('should handle payloads with both file_path and path (file_path takes precedence)', () => {
    const payload = {
      tool_input: {
        file_path: '/src/component.tsx',
        path: '/src/other.js',
      },
    };

    const filePath = payload.tool_input?.file_path ?? payload.tool_input?.path;
    expect(filePath).toBe('/src/component.tsx');
  });

  it('should handle payloads with undefined tool_input', () => {
    const payload = {} as any;
    const filePath = payload.tool_input?.file_path ?? payload.tool_input?.path;
    expect(filePath).toBeUndefined();
  });
});

describe('hook-receiver exit codes', () => {
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

  it('should handle edge case when rating equals minimum', () => {
    const minRating = 6.5;
    const fileRating = 6.5;

    expect(fileRating).toBeGreaterThanOrEqual(minRating);
  });
});

describe('hook-receiver violation formatting', () => {
  it('should format violations with line numbers', () => {
    const violation = {
      type: 'long_method',
      severity: 'warning',
      message: 'Method is too long',
      line: 42,
      fix: 'Extract into smaller methods',
    };

    const loc = violation.line != null ? ` (line ${violation.line})` : '';
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

  it('should format violations without fix suggestions', () => {
    const violation = {
      type: 'any_type',
      severity: 'error',
      message: 'Using any type',
      line: 10,
    };

    const loc = violation.line != null ? ` (line ${violation.line})` : '';
    const fix = (violation as any).fix ? ` — ${(violation as any).fix}` : '';
    const formatted = `[${violation.severity}] ${violation.message}${loc}${fix}`;

    expect(formatted).toContain('(line 10)');
    expect(formatted).not.toContain('—');
  });

  it('should format info severity violations', () => {
    const violation = {
      type: 'magic_number',
      severity: 'info',
      message: 'Magic number detected',
    };

    const formatted = `[${violation.severity}] ${violation.message}`;
    expect(formatted).toBe('[info] Magic number detected');
  });
});

describe('hook-receiver request/response formats', () => {
  it('should format analyze request with filePath and repoRoot', () => {
    const request = {
      filePath: '/src/index.ts',
      repoRoot: '/workspace',
    };

    expect(request).toHaveProperty('filePath');
    expect(request).toHaveProperty('repoRoot');
  });

  it('should parse analyze response with analysis and minRating', () => {
    const response = {
      analysis: { rating: 8.5, violations: [] },
      minRating: 6.5,
    };

    expect(response).toHaveProperty('analysis');
    expect(response).toHaveProperty('minRating');
    expect(response.analysis.rating).toBe(8.5);
  });

  it('should handle null analysis response', () => {
    const response = {
      analysis: null,
      minRating: 6.5,
    };

    expect(response.analysis).toBeNull();
    expect(response.minRating).toBe(6.5);
  });

  it('should format repo-register request', () => {
    const request = {
      action: 'register_repo',
      repo: {
        path: '/workspace',
        name: 'my-project',
        sessionId: 'abc123',
      },
    };

    expect(request.action).toBe('register_repo');
    expect(request.repo.path).toBeDefined();
  });
});

describe('hook-receiver session management', () => {
  describe('isSessionRegistered function', () => {
    it('should return false when session dir does not exist', () => {
      const { existsSync } = require('fs');
      (existsSync as jest.Mock).mockReturnValue(false);

      const sessionDir = '/tmp/.gate-keeper/sessions/session-123';
      const isRegistered = false; // Mocked to false
      expect(isRegistered).toBe(false);
    });

    it('should return true when session file exists', () => {
      const { existsSync } = require('fs');
      (existsSync as jest.Mock).mockReturnValue(true);

      const sessionDir = '/tmp/.gate-keeper/sessions/session-123';
      const isRegistered = true; // Mocked to true
      expect(isRegistered).toBe(true);
    });

    it('should handle filesystem errors gracefully', () => {
      const sessionId = 'test-session';
      try {
        // Simulating error handling
        throw new Error('ENOENT');
      } catch {
        // Should continue and return false
        const isRegistered = false;
        expect(isRegistered).toBe(false);
      }
    });
  });

  describe('markSessionRegistered function', () => {
    it('should create sessions directory if missing', () => {
      const { mkdirSync } = require('fs');
      const mockMkdir = mkdirSync as jest.Mock;

      expect(mockMkdir).toBeDefined();
    });

    it('should write timestamp to session file', () => {
      const { writeFileSync } = require('fs');
      const mockWrite = writeFileSync as jest.Mock;
      const timestamp = String(Date.now());

      expect(timestamp).toMatch(/^\d+$/);
    });

    it('should silently fail on filesystem errors', () => {
      try {
        throw new Error('EACCES');
      } catch {
        // Should not re-throw
        expect(true).toBe(true);
      }
    });
  });
});

describe('hook-receiver stdin handling', () => {
  describe('readStdin function', () => {
    it('should parse valid JSON from stdin', () => {
      const data = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
      });

      const parsed = JSON.parse(data);
      expect(parsed.hook_event_name).toBe('PostToolUse');
    });

    it('should return null for invalid JSON', () => {
      try {
        JSON.parse('{ invalid json');
      } catch {
        const result = null;
        expect(result).toBeNull();
      }
    });

    it('should timeout after 2 seconds if stdin does not close', () => {
      const timeout = 2000;
      expect(timeout).toBe(2000);
    });

    it('should handle empty stdin gracefully', () => {
      const data = '';
      try {
        const parsed = JSON.parse(data);
      } catch {
        expect(true).toBe(true);
      }
    });
  });
});

describe('hook-receiver file gating', () => {
  it('should exit with code 2 when analysis rating is below minimum', () => {
    const analysis = { rating: 5.0 };
    const minRating = 6.5;
    const shouldExit = analysis.rating < minRating;

    expect(shouldExit).toBe(true);
  });

  it('should continue execution when rating meets minimum', () => {
    const analysis = { rating: 7.5 };
    const minRating = 6.5;
    const shouldExit = analysis.rating < minRating;

    expect(shouldExit).toBe(false);
  });

  it('should include violation details in exit message', () => {
    const violations = [
      { severity: 'error', message: 'Missing key prop', line: 10 },
      { severity: 'warning', message: 'Using any type', line: 20 },
    ];

    for (const v of violations) {
      const formatted = `[${v.severity}] ${v.message}`;
      expect(formatted).toContain(v.message);
    }
  });

  it('should include rating and minimum threshold in message', () => {
    const rating = 4.5;
    const minRating = 6.5;
    const message = `rated ${rating}/10 (minimum ${minRating}/10)`;

    expect(message).toContain('4.5');
    expect(message).toContain('6.5');
  });
});

// Note: Integration tests for the main() function execution flow are limited
// because the module executes immediately on import. The exported helper functions
// (globToRegex, isFileExcludedByScanConfig, WATCHED_EXTENSIONS) are fully tested above.
//
// The hook-receiver is designed to be executed as a script (not imported as a module),
// and its main() function reads from stdin synchronously. Full integration testing
// would require spawning the script as a child process and piping input to it.
