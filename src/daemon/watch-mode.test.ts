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
