import { FixWorker } from './fix-worker';
import { FileAnalysis } from '../types';

interface FakeHandle {
  scriptFile: string;
  promptFile: string;
  statusFile: string;
  logFile: string;
}

describe('FixWorker', () => {
  const opts = {
    filePath: '/repo/src/foo.ts',
    repo: '/repo',
    threshold: 7,
  };

  const baseMetrics = { loc: 50, complexity: 3, importCount: 2, hookCount: 0 };

  const passingAnalysis: FileAnalysis = {
    filePath: opts.filePath,
    language: 'typescript',
    rating: 8.5,
    violations: [],
    metrics: baseMetrics,
    imports: [],
    exports: [],
    lastAnalyzed: Date.now(),
  } as unknown as FileAnalysis;

  const failingAnalysis: FileAnalysis = {
    ...passingAnalysis,
    rating: 4,
    violations: [
      { severity: 'warning', message: 'any used', line: 10, fix: 'use unknown' } as never,
      { severity: 'error', message: 'missing key', line: 22 } as never,
    ],
  };

  const fakeHandle: FakeHandle = {
    scriptFile: '/tmp/gk-fix-test.sh',
    promptFile: '/tmp/gk-fix-test.prompt',
    statusFile: '/tmp/gk-fix-test.status',
    logFile:    '/tmp/gk-fix-test.log',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Early-exit fast paths ──────────────────────────────────────────────────

  it('returns early when current rating already meets threshold', async () => {
    const worker = new FixWorker(opts);
    jest.spyOn(worker as any, 'fetchAnalysis').mockResolvedValue(passingAnalysis);

    const result = await worker.fix();

    expect(result.success).toBe(true);
    expect(result.fixSummary).toBe('Already passes threshold');
    expect(result.attemptNumber).toBe(0);
    expect(result.shouldRetry).toBe(false);
  });

  it('returns a non-retry failure when analysis cannot be fetched', async () => {
    const worker = new FixWorker(opts);
    jest.spyOn(worker as any, 'fetchAnalysis').mockResolvedValue(null);

    const result = await worker.fix();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Could not fetch analysis');
    expect(result.shouldRetry).toBe(false);
  });

  it('returns a retryable failure when terminal cannot be opened', async () => {
    const worker = new FixWorker(opts);
    jest.spyOn(worker as any, 'fetchAnalysis').mockResolvedValue(failingAnalysis);
    jest.spyOn(worker as any, 'openTerminal').mockReturnValue(false);

    const result = await worker.fix();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Could not open terminal');
    expect(result.shouldRetry).toBe(true);
    expect(result.ratingBefore).toBe(failingAnalysis.rating);
    expect(result.violationsRemaining).toBe(failingAnalysis.violations.length);
  });

  // ── waitForCompletion — status-file signal paths ───────────────────────────

  it('returns shouldRetry:false when Claude exits cleanly but rating stays below threshold', async () => {
    const worker = new FixWorker(opts);
    const stillBad: FileAnalysis = { ...failingAnalysis, rating: 5 };

    jest.spyOn(worker as any, 'fetchAnalysis').mockResolvedValue(failingAnalysis);
    jest.spyOn(worker as any, 'openTerminal').mockReturnValue(true);
    jest.spyOn(worker as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(worker as any, 'reanalyze').mockResolvedValue(stillBad);
    jest.spyOn(worker as any, 'readStatus').mockReturnValue({ exitCode: 0, timestamp: 1000 });

    const result = await worker.fix();

    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(false);
    expect(result.fixSummary).toContain('below threshold');
  });

  it('returns shouldRetry:true when Claude exits with non-zero code (crash/window closed)', async () => {
    const worker = new FixWorker(opts);

    jest.spyOn(worker as any, 'fetchAnalysis').mockResolvedValue(failingAnalysis);
    jest.spyOn(worker as any, 'openTerminal').mockReturnValue(true);
    jest.spyOn(worker as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(worker as any, 'reanalyze').mockResolvedValue(failingAnalysis);
    jest.spyOn(worker as any, 'readStatus').mockReturnValue({ exitCode: 1, timestamp: 1000 });

    const result = await worker.fix();

    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.error).toMatch(/exit 1/);
  });

  it('returns success when Claude exits cleanly and rating is above threshold', async () => {
    const worker = new FixWorker(opts);
    const improved: FileAnalysis = { ...passingAnalysis, rating: 8 };

    jest.spyOn(worker as any, 'fetchAnalysis').mockResolvedValue(failingAnalysis);
    jest.spyOn(worker as any, 'openTerminal').mockReturnValue(true);
    jest.spyOn(worker as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(worker as any, 'reanalyze').mockResolvedValue(improved);
    jest.spyOn(worker as any, 'readStatus').mockReturnValue({ exitCode: 0, timestamp: 1000 });

    const result = await worker.fix();

    expect(result.success).toBe(true);
    expect(result.shouldRetry).toBe(false);
    expect(result.newRating).toBe(8);
    expect(result.fixSummary).toContain('Rating improved');
  });

  it('returns success early when threshold is met before Claude signals completion', async () => {
    const worker = new FixWorker(opts);
    const improved: FileAnalysis = { ...passingAnalysis, rating: 8 };

    jest.spyOn(worker as any, 'fetchAnalysis').mockResolvedValue(failingAnalysis);
    jest.spyOn(worker as any, 'openTerminal').mockReturnValue(true);
    jest.spyOn(worker as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(worker as any, 'reanalyze').mockResolvedValue(improved);
    // No status file yet — Claude still running
    jest.spyOn(worker as any, 'readStatus').mockReturnValue(null);

    const result = await worker.fix();

    expect(result.success).toBe(true);
    expect(result.newRating).toBe(8);
    expect(result.fixSummary).toContain('Threshold met mid-session');
    expect(result.shouldRetry).toBe(false);
  });

  it('returns retryable timeout failure when polling exhausts MAX_WAIT without signal', async () => {
    const worker = new FixWorker(opts);

    jest.spyOn(worker as any, 'fetchAnalysis').mockResolvedValue(failingAnalysis);
    jest.spyOn(worker as any, 'openTerminal').mockReturnValue(true);
    jest.spyOn(worker as any, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(worker as any, 'reanalyze').mockResolvedValue(null);
    jest.spyOn(worker as any, 'readStatus').mockReturnValue(null);

    const result = await worker.fix();

    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(true);
    expect(result.error).toMatch(/threshold/);
    expect(result.fixSummary).toMatch(/Timed out/);
  });

  // ── readStatus ─────────────────────────────────────────────────────────────

  it('readStatus returns null when status file does not exist', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    const result = (worker as unknown as { readStatus: (f: string) => unknown }).readStatus('/tmp/missing.status');
    expect(result).toBeNull();
  });

  it('readStatus returns parsed object when file exists', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue('{"exitCode":0,"timestamp":1234567890}' as never);

    const result = (worker as unknown as { readStatus: (f: string) => unknown }).readStatus('/tmp/ok.status');
    expect(result).toEqual({ exitCode: 0, timestamp: 1234567890 });
  });

  it('readStatus returns null on malformed JSON', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue('not-json' as never);

    const result = (worker as unknown as { readStatus: (f: string) => unknown }).readStatus('/tmp/bad.status');
    expect(result).toBeNull();
  });

  // ── openTerminal ───────────────────────────────────────────────────────────

  it('openTerminal returns false when writing the prompt file fails', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('disk full'); });

    const result = (worker as unknown as { openTerminal: (p: string, c: string, h: FakeHandle) => boolean })
      .openTerminal('prompt text', 'claude', fakeHandle);
    expect(result).toBe(false);
  });

  it('openTerminal dispatches to tryOpenWSL when in WSL', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'chmodSync').mockImplementation(() => undefined);
    jest.spyOn(worker as any, 'isWSL').mockReturnValue(true);
    const wslSpy = jest.spyOn(worker as any, 'tryOpenWSL').mockReturnValue(true);

    const result = (worker as unknown as { openTerminal: (p: string, c: string, h: FakeHandle) => boolean })
      .openTerminal('prompt text', 'claude', fakeHandle);
    expect(result).toBe(true);
    expect(wslSpy).toHaveBeenCalled();
  });

  it('openTerminal dispatches to tryOpenLinux when not in WSL', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'chmodSync').mockImplementation(() => undefined);
    jest.spyOn(worker as any, 'isWSL').mockReturnValue(false);
    const linuxSpy = jest.spyOn(worker as any, 'tryOpenLinux').mockReturnValue(true);

    const result = (worker as unknown as { openTerminal: (p: string, c: string, h: FakeHandle) => boolean })
      .openTerminal('prompt text', 'claude', fakeHandle);
    expect(result).toBe(true);
    expect(linuxSpy).toHaveBeenCalled();
  });

  // ── tryOpenWSL ─────────────────────────────────────────────────────────────

  it('tryOpenWSL succeeds via wt.exe when available', () => {
    const worker = new FixWorker(opts);
    const cp = require('child_process') as typeof import('child_process');
    (jest.spyOn(cp, 'execSync') as unknown as jest.Mock).mockImplementation(() => '');
    const fakeChild = { unref: jest.fn() } as unknown as ReturnType<typeof cp.spawn>;
    const spawnSpy = jest.spyOn(cp, 'spawn').mockReturnValue(fakeChild);

    const result = (worker as unknown as { tryOpenWSL: (s: string) => boolean }).tryOpenWSL('/tmp/x.sh');
    expect(result).toBe(true);
    expect(spawnSpy).toHaveBeenCalledWith('wt.exe', expect.any(Array), expect.objectContaining({ detached: true }));
  });

  it('tryOpenWSL falls back to cmd.exe when wt.exe is unavailable', () => {
    const worker = new FixWorker(opts);
    const cp = require('child_process') as typeof import('child_process');
    (jest.spyOn(cp, 'execSync') as unknown as jest.Mock).mockImplementation(() => { throw new Error('no wt'); });
    const fakeChild = { unref: jest.fn() } as unknown as ReturnType<typeof cp.spawn>;
    const spawnSpy = jest.spyOn(cp, 'spawn').mockReturnValue(fakeChild);

    const result = (worker as unknown as { tryOpenWSL: (s: string) => boolean }).tryOpenWSL('/tmp/x.sh');
    expect(result).toBe(true);
    expect(spawnSpy).toHaveBeenCalledWith('cmd.exe', expect.any(Array), expect.objectContaining({ detached: true }));
  });

  // ── tryOpenLinux ───────────────────────────────────────────────────────────

  it('tryOpenLinux falls back to bash when no terminal emulator is found', () => {
    const worker = new FixWorker(opts);
    const cp = require('child_process') as typeof import('child_process');
    jest.spyOn(cp, 'execSync').mockImplementation(() => { throw new Error('no such terminal'); });
    const fakeChild = { unref: jest.fn() } as unknown as ReturnType<typeof cp.spawn>;
    const spawnSpy = jest.spyOn(cp, 'spawn').mockReturnValue(fakeChild);

    const result = (worker as unknown as { tryOpenLinux: (s: string) => boolean }).tryOpenLinux('/tmp/x.sh');
    expect(result).toBe(true);
    expect(spawnSpy).toHaveBeenCalledWith('bash', ['/tmp/x.sh'], expect.objectContaining({ detached: true }));
  });

  // ── resolveClaudePath ──────────────────────────────────────────────────────

  it('resolveClaudePath falls back to "claude" when nothing resolves', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const cp = require('child_process') as typeof import('child_process');
    jest.spyOn(cp, 'execSync').mockImplementation(() => { throw new Error('not found'); });

    const resolved = (worker as unknown as { resolveClaudePath: () => string }).resolveClaudePath();
    expect(resolved).toBe('claude');
  });

  it('resolveClaudePath returns the first existing candidate', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'existsSync').mockImplementation((p: unknown) => p === 'claude');

    const resolved = (worker as unknown as { resolveClaudePath: () => string }).resolveClaudePath();
    expect(resolved).toBe('claude');
  });

  it('resolveClaudePath uses `which` output when no candidate file exists', () => {
    const worker = new FixWorker(opts);
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const cp = require('child_process') as typeof import('child_process');
    (jest.spyOn(cp, 'execSync') as unknown as jest.Mock).mockImplementation(() => '/opt/bin/claude\n');

    const resolved = (worker as unknown as { resolveClaudePath: () => string }).resolveClaudePath();
    expect(resolved).toBe('/opt/bin/claude');
  });

  // ── isWSL ──────────────────────────────────────────────────────────────────

  it('isWSL detects WSL via WSL_DISTRO_NAME env var', () => {
    const worker = new FixWorker(opts);
    const prev = process.env['WSL_DISTRO_NAME'];
    process.env['WSL_DISTRO_NAME'] = 'Ubuntu';
    try {
      expect((worker as unknown as { isWSL: () => boolean }).isWSL()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['WSL_DISTRO_NAME'];
      else process.env['WSL_DISTRO_NAME'] = prev;
    }
  });

  it('isWSL detects WSL via /proc/version when env var is absent', () => {
    const worker = new FixWorker(opts);
    const prev = process.env['WSL_DISTRO_NAME'];
    delete process.env['WSL_DISTRO_NAME'];
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'readFileSync').mockReturnValue(
      'Linux version 5.15 (Microsoft@host) gcc' as never
    );
    try {
      expect((worker as unknown as { isWSL: () => boolean }).isWSL()).toBe(true);
    } finally {
      if (prev !== undefined) process.env['WSL_DISTRO_NAME'] = prev;
    }
  });

  it('isWSL returns false when env var absent and /proc/version unreadable', () => {
    const worker = new FixWorker(opts);
    const prev = process.env['WSL_DISTRO_NAME'];
    delete process.env['WSL_DISTRO_NAME'];
    const fs = require('fs') as typeof import('fs');
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('no /proc'); });
    try {
      expect((worker as unknown as { isWSL: () => boolean }).isWSL()).toBe(false);
    } finally {
      if (prev !== undefined) process.env['WSL_DISTRO_NAME'] = prev;
    }
  });

  // ── fetchAnalysis ──────────────────────────────────────────────────────────

  it('fetchAnalysis returns null on non-ok response', async () => {
    const worker = new FixWorker(opts);
    (global as unknown as Record<string, unknown>).fetch = jest.fn().mockResolvedValue({ ok: false });

    const result = await (worker as unknown as { fetchAnalysis: () => Promise<FileAnalysis | null> }).fetchAnalysis();
    expect(result).toBeNull();
  });

  it('fetchAnalysis returns analysis from JSON body on ok response', async () => {
    const worker = new FixWorker(opts);
    (global as unknown as Record<string, unknown>).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ analysis: passingAnalysis }),
    });

    const result = await (worker as unknown as { fetchAnalysis: () => Promise<FileAnalysis | null> }).fetchAnalysis();
    expect(result).toEqual(passingAnalysis);
  });

  it('fetchAnalysis swallows fetch errors and returns null', async () => {
    const worker = new FixWorker(opts);
    (global as unknown as Record<string, unknown>).fetch = jest.fn().mockRejectedValue(new Error('net'));

    const result = await (worker as unknown as { fetchAnalysis: () => Promise<FileAnalysis | null> }).fetchAnalysis();
    expect(result).toBeNull();
  });

  // ── reanalyze ─────────────────────────────────────────────────────────────

  it('reanalyze posts to the daemon and returns parsed analysis', async () => {
    const worker = new FixWorker(opts);
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ analysis: passingAnalysis }),
    });
    (global as unknown as Record<string, unknown>).fetch = mockFetch;

    const result = await (worker as unknown as { reanalyze: () => Promise<FileAnalysis | null> }).reanalyze();
    expect(result).toEqual(passingAnalysis);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/analyze'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('reanalyze returns null on non-ok response', async () => {
    const worker = new FixWorker(opts);
    (global as unknown as Record<string, unknown>).fetch = jest.fn().mockResolvedValue({ ok: false });

    const result = await (worker as unknown as { reanalyze: () => Promise<FileAnalysis | null> }).reanalyze();
    expect(result).toBeNull();
  });

  it('reanalyze swallows errors and returns null', async () => {
    const worker = new FixWorker(opts);
    (global as unknown as Record<string, unknown>).fetch = jest.fn().mockRejectedValue(new Error('boom'));

    const result = await (worker as unknown as { reanalyze: () => Promise<FileAnalysis | null> }).reanalyze();
    expect(result).toBeNull();
  });

  // ── sleep ──────────────────────────────────────────────────────────────────

  it('sleep resolves after the requested delay', async () => {
    jest.useFakeTimers();
    const worker = new FixWorker(opts);
    const p = (worker as unknown as { sleep: (ms: number) => Promise<void> }).sleep(1000);
    jest.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
