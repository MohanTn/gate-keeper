// ── WARNING: Do NOT import http or child_process at top level ──────
// jest.resetModules() re-creates mocked module instances, making
// top-level imports stale. Always require() fresh copies below.
// ──────────────────────────────────────────────────────────────────

// ── Shared mock state ──────────────────────────────────────────────
// Survives jest.resetModules() because it's defined in module scope.
const httpMock = {
  responseData: '',
  shouldError: false,
  shouldTimeout: false,
};

jest.mock('http', () => ({ request: jest.fn() }));
jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({ unref: jest.fn() })),
  spawnSync: jest.fn(() => ({ status: 0, stdout: '/test/repo' })),
}));

// ── Process mocks (independent of module registry) ─────────────────
function mockStdinOn(handler: (event: string, fn: Function) => void) {
  (process.stdin.on as any) = jest.fn(handler);
}

function mockStdoutWrite() {
  (process.stdout.write as any) = jest.fn(() => true);
}

function mockProcessExit() {
  (process.exit as any) = jest.fn((() => {}) as any);
}

/** Override http.request to stream httpMock data through callbacks */
function setupHttpRequest(httpModule: any) {
  httpModule.request.mockImplementation((_options: any, callback?: any) => {
    if (httpMock.shouldError) {
      const req = {
        on: jest.fn((e: string, h: any) => { if (e === 'error') setTimeout(h, 0); return req; }),
        write: jest.fn(), end: jest.fn(), destroy: jest.fn(), setTimeout: jest.fn(),
      } as any;
      return req;
    }
    if (httpMock.shouldTimeout) {
      const req = {
        on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn(),
        setTimeout: jest.fn((_: number, h: any) => { setTimeout(() => { h(); req.destroy(); }, 0); }),
      } as any;
      return req;
    }
    const res = {
      setEncoding: jest.fn(),
      on: jest.fn((e: string, h: any) => {
        if (e === 'data') setTimeout(() => h(httpMock.responseData), 0);
        if (e === 'end') setTimeout(h, 0);
        return res;
      }),
    } as any;
    if (callback) setTimeout(() => callback(res), 0);
    return {
      on: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn(), setTimeout: jest.fn(),
    };
  });
}

afterAll(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// ── WATCHED_EXTENSIONS ─────────────────────────────────────────────
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
    for (const ext of ['.py', '.java', '.go', '.rb', '.rs', '.php', '.css', '.html', '.json']) {
      expect(WATCHED_EXTENSIONS.has(ext)).toBe(false);
    }
  });
});

// ── globToRegex ────────────────────────────────────────────────────
describe('globToRegex', () => {
  it('should convert simple glob pattern to regex', () => {
    const { globToRegex } = require('./hook-receiver');
    const re = globToRegex('*.ts');
    expect(re.test('foo.ts')).toBe(true);
    expect(re.test('foo.js')).toBe(false);
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
  });

  it('should handle exact file patterns', () => {
    const { globToRegex } = require('./hook-receiver');
    const re = globToRegex('*.Designer.cs');
    expect(re.test('Form1.Designer.cs')).toBe(true);
    expect(re.test('test.cs')).toBe(false);
  });
});

// ── isFileExcludedByScanConfig ─────────────────────────────────────
describe('isFileExcludedByScanConfig', () => {
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      scanExcludePatterns: {
        global: ['**/node_modules/**', '**/dist/**'],
        typescript: ['*.d.ts', '**/*.generated.ts'],
        csharp: ['**/Migrations/*.cs', '*.Designer.cs'],
      },
    };
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn((p: string) => p.endsWith('config.json')),
      readFileSync: jest.fn((p: string) => {
        if (p.endsWith('config.json')) return JSON.stringify(mockConfig);
        return '';
      }),
    }));
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
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => false),
    }));
    const { isFileExcludedByScanConfig } = require('./hook-receiver');
    expect(isFileExcludedByScanConfig('/src/foo.ts', '.ts')).toBe(false);
  });

  it('should return false when config is malformed', () => {
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(() => 'invalid json'),
    }));
    const { isFileExcludedByScanConfig } = require('./hook-receiver');
    expect(isFileExcludedByScanConfig('/src/foo.ts', '.ts')).toBe(false);
  });

  it('should handle missing language patterns gracefully', () => {
    mockConfig = { scanExcludePatterns: { global: ['**/temp/**'] } };
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn((p: string) => p.endsWith('config.json')),
      readFileSync: jest.fn(() => JSON.stringify(mockConfig)),
    }));
    const { isFileExcludedByScanConfig } = require('./hook-receiver');
    expect(isFileExcludedByScanConfig('/src/foo.ts', '.ts')).toBe(false);
    expect(isFileExcludedByScanConfig('/temp/foo.ts', '.ts')).toBe(true);
  });

  it('should match patterns against both full path and filename', () => {
    const { isFileExcludedByScanConfig } = require('./hook-receiver');
    expect(isFileExcludedByScanConfig('/src/types.d.ts', '.ts')).toBe(true);
    expect(isFileExcludedByScanConfig('/types.d.ts', '.ts')).toBe(true);
  });
});

// ── isDaemonAlive ──────────────────────────────────────────────────
describe('isDaemonAlive', () => {
  let killSpy: jest.SpyInstance;

  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      readFileSync: jest.fn((p: string) => {
        if (p.endsWith('daemon.pid')) return '12345';
        return '';
      }),
      existsSync: jest.fn((p: string) => p.endsWith('daemon.pid')),
    }));
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('should return true when PID file exists and process is alive', () => {
    const { isDaemonAlive } = require('./hook-receiver');
    expect(isDaemonAlive()).toBe(true);
  });

  it('should return false when PID file does not exist', () => {
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => false),
      readFileSync: jest.fn(() => { throw new Error('ENOENT'); }),
    }));
    const { isDaemonAlive } = require('./hook-receiver');
    expect(isDaemonAlive()).toBe(false);
  });

  it('should return false when PID is NaN', () => {
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      readFileSync: jest.fn(() => 'not-a-number'),
      existsSync: jest.fn(() => true),
    }));
    const { isDaemonAlive } = require('./hook-receiver');
    expect(isDaemonAlive()).toBe(false);
  });

  it('should return false when process.kill throws (process not running)', () => {
    killSpy.mockImplementation(() => { throw new Error('ESRCH'); });
    const { isDaemonAlive } = require('./hook-receiver');
    expect(isDaemonAlive()).toBe(false);
  });

  it('should return false when reading PID file throws', () => {
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      readFileSync: jest.fn(() => { throw new Error('ENOENT'); }),
      existsSync: jest.fn(() => true),
    }));
    const { isDaemonAlive } = require('./hook-receiver');
    expect(isDaemonAlive()).toBe(false);
  });
});

// ── ensureDaemonRunning ────────────────────────────────────────────
describe('ensureDaemonRunning', () => {
  let killSpy: jest.SpyInstance;

  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      readFileSync: jest.fn((p: string) => {
        if (p.endsWith('daemon.pid')) return '12345';
        return '';
      }),
      existsSync: jest.fn((p: string) => {
        if (p.endsWith('daemon.pid')) return true;
        if (p.endsWith('daemon.js')) return true;
        return false;
      }),
    }));
    // Get fresh child_process mock and set default behavior
    const cp = require('child_process');
    cp.spawn.mockReturnValue({ unref: jest.fn() });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('should not spawn if daemon is already alive', async () => {
    const cp = require('child_process');
    const { ensureDaemonRunning } = require('./hook-receiver');
    await ensureDaemonRunning();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('should not spawn if daemon script does not exist', async () => {
    killSpy.mockImplementation(() => { throw new Error('ESRCH'); });
    jest.resetModules();
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      readFileSync: jest.fn((p: string) => {
        if (p.endsWith('daemon.pid')) return '12345';
        return '';
      }),
      existsSync: jest.fn((p: string) => {
        if (p.endsWith('daemon.pid')) return true;
        return false; // ← daemon.js does NOT exist
      }),
    }));
    const cp = require('child_process');
    const { ensureDaemonRunning } = require('./hook-receiver');
    await ensureDaemonRunning();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('should spawn daemon when not alive and script exists', async () => {
    killSpy.mockImplementation(() => { throw new Error('ESRCH'); });
    const cp = require('child_process');
    const { ensureDaemonRunning } = require('./hook-receiver');
    await ensureDaemonRunning();
    expect(cp.spawn).toHaveBeenCalledTimes(1);
  });
});

// ── isSessionRegistered ────────────────────────────────────────────
describe('isSessionRegistered', () => {
  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
  });

  it('should return true when session file exists', () => {
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => true),
    }));
    const { isSessionRegistered } = require('./hook-receiver');
    expect(isSessionRegistered('test-session')).toBe(true);
  });

  it('should return false when session file does not exist', () => {
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => false),
    }));
    const { isSessionRegistered } = require('./hook-receiver');
    expect(isSessionRegistered('test-session')).toBe(false);
  });

  it('should return false when existsSync throws', () => {
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => { throw new Error('EACCES'); }),
    }));
    const { isSessionRegistered } = require('./hook-receiver');
    expect(isSessionRegistered('test-session')).toBe(false);
  });
});

// ── markSessionRegistered ──────────────────────────────────────────
describe('markSessionRegistered', () => {
  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
  });

  it('should create session directory and write timestamp', () => {
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
    }));
    const { markSessionRegistered } = require('./hook-receiver');
    markSessionRegistered('test-session');
    const fsMock = require('fs');
    expect(fsMock.mkdirSync).toHaveBeenCalled();
    expect(fsMock.writeFileSync).toHaveBeenCalled();
  });

  it('should silently handle filesystem errors', () => {
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      mkdirSync: jest.fn(() => { throw new Error('EACCES'); }),
      writeFileSync: jest.fn(),
    }));
    const { markSessionRegistered } = require('./hook-receiver');
    expect(() => markSessionRegistered('test-session')).not.toThrow();
  });
});

// ── findGitRoot ────────────────────────────────────────────────────
describe('findGitRoot', () => {
  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
  });

  it('should return git root when git command succeeds', () => {
    const cp = require('child_process');
    cp.spawnSync.mockReturnValue({ status: 0, stdout: '/my/repo' });
    const { findGitRoot } = require('./hook-receiver');
    expect(findGitRoot('/some/dir')).toBe('/my/repo');
  });

  it('should return input dir when git command fails', () => {
    const cp = require('child_process');
    cp.spawnSync.mockReturnValue({ status: 1, stdout: '' });
    const { findGitRoot } = require('./hook-receiver');
    expect(findGitRoot('/some/dir')).toBe('/some/dir');
  });

  it('should return input dir when stdout is empty', () => {
    const cp = require('child_process');
    cp.spawnSync.mockReturnValue({ status: 0, stdout: '' });
    const { findGitRoot } = require('./hook-receiver');
    expect(findGitRoot('/some/dir')).toBe('/some/dir');
  });
});

// ── readStdin ──────────────────────────────────────────────────────
describe('readStdin', () => {
  let stdinHandlers: Record<string, Function>;

  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
    stdinHandlers = {};
    mockStdinOn((event: string, handler: Function) => {
      stdinHandlers[event] = handler;
    });
    mockProcessExit();
  });

  it('should parse valid JSON from stdin and resolve', async () => {
    const hr = require('./hook-receiver');
    const promise = hr.readStdin();
    stdinHandlers['data']('{"hook_event_name":"PostToolUse"}');
    stdinHandlers['end']();
    const result = await promise;
    expect(result).toEqual({ hook_event_name: 'PostToolUse' });
  });

  it('should return null for invalid JSON', async () => {
    const hr = require('./hook-receiver');
    const promise = hr.readStdin();
    stdinHandlers['data']('{ invalid json');
    stdinHandlers['end']();
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return null when stdin times out', async () => {
    jest.useFakeTimers();
    const hr = require('./hook-receiver');
    const promise = hr.readStdin();
    jest.advanceTimersByTime(2500);
    const result = await promise;
    expect(result).toBeNull();
    jest.useRealTimers();
  });
});

// ── sendToDaemon ───────────────────────────────────────────────────
describe('sendToDaemon', () => {
  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
    const httpModule = require('http');
    setupHttpRequest(httpModule);
    const cp = require('child_process');
    cp.spawnSync.mockReturnValue({ status: 0, stdout: '/test/repo' });
  });

  it('should send file path and return analysis response', async () => {
    const expected = { analysis: { rating: 8.5, violations: [] }, minRating: 6.5 };
    httpMock.responseData = JSON.stringify(expected);
    const { sendToDaemon } = require('./hook-receiver');
    const result = await sendToDaemon('/test/file.ts');
    expect(result).toEqual(expected);
  });

  it('should return null on request error', async () => {
    httpMock.shouldError = true;
    const { sendToDaemon } = require('./hook-receiver');
    const result = await sendToDaemon('/test/file.ts');
    expect(result).toBeNull();
  });

  it('should return null on request timeout', async () => {
    httpMock.shouldTimeout = true;
    const { sendToDaemon } = require('./hook-receiver');
    const result = await sendToDaemon('/test/file.ts');
    expect(result).toBeNull();
  });

  it('should return null on invalid JSON response', async () => {
    httpMock.responseData = 'not-json';
    const { sendToDaemon } = require('./hook-receiver');
    const result = await sendToDaemon('/test/file.ts');
    expect(result).toBeNull();
  });
});

// ── registerRepository ─────────────────────────────────────────────
describe('registerRepository', () => {
  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
    const httpModule = require('http');
    setupHttpRequest(httpModule);
    const cp = require('child_process');
    cp.spawnSync.mockReturnValue({ status: 0, stdout: '/test/repo' });
  });

  const makePayload = () => ({
    hook_event_name: 'session_create' as const,
    tool_name: 'claude',
    session_id: 'session-abc',
    session_info: {
      workspace_path: '/workspace',
      git_root: '/workspace',
      session_type: 'claude',
    },
  });

  it('should send registration to daemon', async () => {
    httpMock.responseData = '';
    const { registerRepository } = require('./hook-receiver');
    await registerRepository(makePayload());
    const httpModule = require('http');
    expect(httpModule.request).toHaveBeenCalled();
    expect(httpModule.request.mock.calls[0][0].path).toBe('/repo-register');
  });

  it('should resolve on request error', async () => {
    httpMock.shouldError = true;
    const { registerRepository } = require('./hook-receiver');
    await expect(registerRepository(makePayload())).resolves.toBeUndefined();
  });

  it('should resolve on request timeout', async () => {
    httpMock.shouldTimeout = true;
    const { registerRepository } = require('./hook-receiver');
    await expect(registerRepository(makePayload())).resolves.toBeUndefined();
  });
});

// ── main() ─────────────────────────────────────────────────────────
describe('main', () => {
  let stdinHandlers: Record<string, Function>;
  let killSpy: jest.SpyInstance;

  function fireStdin(data: string) {
    stdinHandlers['data'](data);
    stdinHandlers['end']();
  }

  async function runMain(payload: object) {
    const hr = require('./hook-receiver');
    const p = hr.main();
    fireStdin(JSON.stringify(payload));
    await new Promise(r => setTimeout(r, 150));
    return p;
  }

  beforeEach(() => {
    httpMock.responseData = '';
    httpMock.shouldError = false;
    httpMock.shouldTimeout = false;
    jest.resetModules();
    stdinHandlers = {};
    mockStdinOn((event: string, handler: Function) => {
      stdinHandlers[event] = handler;
    });
    mockStdoutWrite();
    mockProcessExit();
    killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      readFileSync: jest.fn((p: string) => {
        if (p.endsWith('daemon.pid')) return '12345';
        return '';
      }),
      existsSync: jest.fn((p: string) => {
        if (p.endsWith('daemon.pid')) return true;
        if (p.endsWith('daemon.js')) return true;
        return false;
      }),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
    }));
    const cp = require('child_process');
    cp.spawnSync.mockReturnValue({ status: 0, stdout: '/test/repo' });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('should exit early when stdin returns null payload', async () => {
    const hr = require('./hook-receiver');
    const p = hr.main();
    stdinHandlers['data']('not json');
    stdinHandlers['end']();
    await expect(p).resolves.toBeUndefined();
  });

  it('should handle session_create event', async () => {
    const httpModule = require('http');
    setupHttpRequest(httpModule);
    httpMock.responseData = '';
    await runMain({
      hook_event_name: 'session_create',
      tool_name: 'claude',
      session_id: 'session-abc',
      session_info: { workspace_path: '/workspace', git_root: '/workspace', session_type: 'claude' },
    });
    const httpModule2 = require('http');
    expect(httpModule2.request).toHaveBeenCalled();
  });

  it('should handle SessionStart event', async () => {
    const httpModule = require('http');
    setupHttpRequest(httpModule);
    httpMock.responseData = '';
    await runMain({
      hook_event_name: 'SessionStart',
      session_id: 'session-xyz',
      cwd: '/workspace',
    });
    const httpModule2 = require('http');
    expect(httpModule2.request).toHaveBeenCalled();
  });

  it('should handle SessionStart without session_id or cwd', async () => {
    const hr = require('./hook-receiver');
    const p = hr.main();
    fireStdin(JSON.stringify({ hook_event_name: 'SessionStart' }));
    await new Promise(r => setTimeout(r, 50));
    await expect(p).resolves.toBeUndefined();
  });

  it('should handle UserPromptSubmit for a new session', async () => {
    const httpModule = require('http');
    setupHttpRequest(httpModule);
    httpMock.responseData = '';
    await runMain({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-new',
      cwd: '/workspace',
    });
    const httpModule2 = require('http');
    expect(httpModule2.request).toHaveBeenCalled();
  });

  it('should handle PostToolUse with watched file and rating below minimum', async () => {
    httpMock.responseData = JSON.stringify({
      analysis: { rating: 4.0, violations: [{ severity: 'error', message: 'Bad code', line: 10, fix: 'Fix it' }], metrics: {} },
      minRating: 6.5,
    });
    const httpModule = require('http');
    setupHttpRequest(httpModule);
    const hr = require('./hook-receiver');
    const p = hr.main();
    fireStdin(JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/test/file.ts' },
    }));
    await new Promise(r => setTimeout(r, 150));
    await expect(p).resolves.toBeUndefined();
    expect(process.exit).toHaveBeenCalledWith(2);
  });

  it('should not exit when rating meets minimum', async () => {
    httpMock.responseData = JSON.stringify({
      analysis: { rating: 8.5, violations: [], metrics: {} },
      minRating: 6.5,
    });
    const httpModule = require('http');
    setupHttpRequest(httpModule);
    const hr = require('./hook-receiver');
    const p = hr.main();
    fireStdin(JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/test/file.ts' },
    }));
    await new Promise(r => setTimeout(r, 150));
    await expect(p).resolves.toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('should skip unsupported file extensions', async () => {
    const hr = require('./hook-receiver');
    const p = hr.main();
    fireStdin(JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/test/file.py' },
    }));
    await new Promise(r => setTimeout(r, 50));
    await expect(p).resolves.toBeUndefined();
    const httpModule = require('http');
    expect(httpModule.request).not.toHaveBeenCalled();
  });

  it('should skip when tool_input has no file_path or path', async () => {
    const hr = require('./hook-receiver');
    const p = hr.main();
    fireStdin(JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: {},
    }));
    await new Promise(r => setTimeout(r, 50));
    await expect(p).resolves.toBeUndefined();
  });
});
