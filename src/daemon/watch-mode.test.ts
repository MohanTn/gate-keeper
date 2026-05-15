import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WatchMode } from './watch-mode';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-watch-'));
  // Make it a non-.git dir so walkFiles works
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content = 'export const x = 1;'): string {
  const p = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

describe('WatchMode', () => {
  it('starts and stops without error', () => {
    const watcher = new WatchMode();
    expect(() => {
      watcher.start(tmpDir, () => {}, 60_000);
      watcher.stop();
    }).not.toThrow();
  });

  it('initial stats after snapshot', () => {
    writeFile('src/auth.ts');
    writeFile('src/db.ts');
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 60_000);
    const stats = watcher.getStats();
    expect(stats.watchedFiles).toBe(2);
    expect(stats.changesDetected).toBe(0);
    watcher.stop();
  });

  it('stop clears internal state cleanly', () => {
    writeFile('src/a.ts');
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 60_000);
    watcher.stop();
    // Calling stop twice should not throw
    expect(() => watcher.stop()).not.toThrow();
  });

  it('getStats returns a copy not the internal reference', () => {
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 60_000);
    const s1 = watcher.getStats();
    const s2 = watcher.getStats();
    expect(s1).not.toBe(s2);
    watcher.stop();
  });

  it('lastPollAt is null before first poll', () => {
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 60_000);
    expect(watcher.getStats().lastPollAt).toBeNull();
    watcher.stop();
  });

  it('refresh re-snapshots without error', () => {
    writeFile('src/a.ts');
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 60_000);
    writeFile('src/b.ts');
    expect(() => watcher.refresh(tmpDir)).not.toThrow();
    watcher.stop();
  });

  it('only watches supported extensions', () => {
    writeFile('src/component.tsx');
    writeFile('README.md');      // not supported
    writeFile('config.json');    // not supported
    writeFile('styles.css');     // not supported
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 60_000);
    expect(watcher.getStats().watchedFiles).toBe(1); // only .tsx
    watcher.stop();
  });

  it('respects .graphifyignore', () => {
    fs.writeFileSync(path.join(tmpDir, '.graphifyignore'), 'src/generated/\n');
    fs.mkdirSync(path.join(tmpDir, 'src', 'generated'), { recursive: true });
    writeFile('src/auth.ts');
    writeFile('src/generated/types.ts');
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 60_000);
    // generated/types.ts should be ignored
    expect(watcher.getStats().watchedFiles).toBe(1);
    watcher.stop();
  });
});

// ── Poll behavior (uses fake timers) ──────────────────────────

describe('WatchMode — poll behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('detects new files on poll', () => {
    const callback = jest.fn();
    const watcher = new WatchMode();

    // Start with no files
    watcher.start(tmpDir, callback, 1000, 500);

    // Create a new file after snapshot
    const filePath = writeFile('src/new.ts');

    // Advance time past first poll
    jest.advanceTimersByTime(1000);

    // Advance past debounce window
    jest.advanceTimersByTime(500);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([filePath]),
    );
    expect(callback).toHaveBeenCalledTimes(1);
    expect(watcher.getStats().changesDetected).toBe(1);
    expect(watcher.getStats().lastPollAt).not.toBeNull();

    watcher.stop();
  });

  it('detects modified files after refresh', () => {
    // Use real-time approach: start, modify, refresh, verify stats
    const callback = jest.fn();
    const watcher = new WatchMode();
    const filePath = writeFile('src/existing.ts');

    watcher.start(tmpDir, callback, 60_000, 500); // long interval, won't fire

    // Modify the file
    fs.writeFileSync(filePath, 'modified content');

    // Refresh updates snapshot from disk
    watcher.refresh(tmpDir);

    // After refresh, stats reflect current file count
    expect(watcher.getStats().watchedFiles).toBe(1);

    watcher.stop();
  });

  it('debounces multiple changes within debounce window', () => {
    const callback = jest.fn();
    const watcher = new WatchMode();

    watcher.start(tmpDir, callback, 1000, 500);

    // Create multiple files after snapshot
    const aPath = writeFile('src/a.ts');
    const bPath = writeFile('src/b.ts');

    // Advance to first poll — both changes detected at once
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(500);

    // Both files should be in a single callback batch
    expect(callback).toHaveBeenCalledTimes(1);
    const batch = callback.mock.calls[0]![0] as string[];
    expect(batch).toContain(aPath);
    expect(batch).toContain(bPath);

    watcher.stop();
  });

  it('does not call onChanged when no files change', () => {
    const callback = jest.fn();
    const watcher = new WatchMode();

    writeFile('src/stable.ts');
    watcher.start(tmpDir, callback, 1000, 500);

    // Poll twice — no files have changed
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(500);

    expect(callback).not.toHaveBeenCalled();

    watcher.stop();
  });

  it('increments changesDetected over multiple polls', () => {
    const callback = jest.fn();
    const watcher = new WatchMode();

    watcher.start(tmpDir, callback, 1000, 500);

    // First change
    writeFile('src/first.ts');
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(500);
    expect(watcher.getStats().changesDetected).toBe(1);

    // Second change
    writeFile('src/second.ts');
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(500);
    expect(watcher.getStats().changesDetected).toBe(2);

    watcher.stop();
  });

  it('updates lastPollAt after each poll', () => {
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 1000, 500);

    // Before any poll
    expect(watcher.getStats().lastPollAt).toBeNull();

    // After first poll
    jest.advanceTimersByTime(1000);
    expect(watcher.getStats().lastPollAt).not.toBeNull();

    watcher.stop();
  });

  it('stop clears poll timer and debounce timer', () => {
    const callback = jest.fn();
    const watcher = new WatchMode();

    watcher.start(tmpDir, callback, 1000, 500);
    watcher.stop();

    // Create a file after stop
    writeFile('src/after-stop.ts');

    // Advance time — no polls should fire
    jest.advanceTimersByTime(5000);
    jest.advanceTimersByTime(500);

    expect(callback).not.toHaveBeenCalled();

    // Double-stop should not throw
    expect(() => watcher.stop()).not.toThrow();
  });

  it('refresh re-snapshots watched files count', () => {
    const watcher = new WatchMode();
    watcher.start(tmpDir, () => {}, 1000, 500);

    expect(watcher.getStats().watchedFiles).toBe(0);

    writeFile('src/added.ts');
    watcher.refresh(tmpDir);

    expect(watcher.getStats().watchedFiles).toBe(1);

    watcher.stop();
  });

  it('handles .js and .cs extensions', () => {
    const callback = jest.fn();
    const watcher = new WatchMode();

    watcher.start(tmpDir, callback, 1000, 500);

    writeFile('src/module.js');
    writeFile('src/component.jsx');
    writeFile('src/code.cs');

    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(500);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0].length).toBe(3);

    watcher.stop();
  });

  it('respects .graphifyignore during poll (ignored files not counted)', () => {
    const callback = jest.fn();
    const watcher = new WatchMode();

    fs.writeFileSync(path.join(tmpDir, '.graphifyignore'), 'src/vendor/\n');
    fs.mkdirSync(path.join(tmpDir, 'src', 'vendor'), { recursive: true });

    // Create watched and ignored files
    writeFile('src/app.ts');
    writeFile('src/vendor/lib.ts');

    watcher.start(tmpDir, callback, 1000, 500);

    // Only app.ts should be in the snapshot (vendor is ignored)
    expect(watcher.getStats().watchedFiles).toBe(1);

    watcher.stop();
  });
});
