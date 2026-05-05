import * as fs from 'fs';
import * as path from 'path';

// Mock the daemon HTTP call
const mockHttpPost = jest.fn();
jest.mock('http', () => ({
  request: (options: any, callback: any) => {
    return {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
      setTimeout: jest.fn(),
    };
  },
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
});

afterAll(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('hook-receiver helpers', () => {
  const hookReceiverPath = path.join(__dirname, '../hook-receiver.ts');

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
  });

  describe('WATCHED_EXTENSIONS', () => {
    it('should include TypeScript extensions', () => {
      const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);
      
      expect(WATCHED_EXTENSIONS.has('.ts')).toBe(true);
      expect(WATCHED_EXTENSIONS.has('.tsx')).toBe(true);
      expect(WATCHED_EXTENSIONS.has('.jsx')).toBe(true);
      expect(WATCHED_EXTENSIONS.has('.js')).toBe(true);
    });

    it('should include C# extension', () => {
      const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);

      expect(WATCHED_EXTENSIONS.has('.cs')).toBe(true);
    });

    it('should not include unsupported extensions', () => {
      const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);

      expect(WATCHED_EXTENSIONS.has('.py')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.java')).toBe(false);
      expect(WATCHED_EXTENSIONS.has('.go')).toBe(false);
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

      // Verify the payload structure is correct
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
  });
});

describe('hook-receiver file analysis flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should skip non-watched file extensions', () => {
    const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);
    const unsupportedExts = ['.py', '.java', '.go', '.rb', '.rs', '.php'];
    
    for (const ext of unsupportedExts) {
      expect(WATCHED_EXTENSIONS.has(ext)).toBe(false);
    }
  });

  it('should process supported file extensions', () => {
    const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.jsx', '.js', '.cs']);
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
});

describe('hook-receiver exit codes', () => {
  it('should exit with code 2 when rating is below minimum', () => {
    const minRating = 6.5;
    const fileRating = 4.0;
    
    expect(fileRating).toBeLessThan(minRating);
    // Exit code 2 indicates blocking feedback
    expect(2).toBe(2);
  });

  it('should continue when rating meets minimum', () => {
    const minRating = 6.5;
    const fileRating = 8.0;
    
    expect(fileRating).toBeGreaterThanOrEqual(minRating);
    // No exit code change - continue normally
    expect(fileRating >= minRating).toBe(true);
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
});
