import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseGraphifyIgnore, loadGraphifyIgnore, shouldIgnoreByGraphifyIgnore } from './graphify-ignore';

const REPO = '/repo';

describe('parseGraphifyIgnore', () => {
  it('ignores blank lines and comments', () => {
    const rules = parseGraphifyIgnore('# comment\n\n# another\n');
    expect(rules).toHaveLength(0);
  });

  it('parses a simple pattern', () => {
    const rules = parseGraphifyIgnore('*.generated.ts');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.pattern).toBe('*.generated.ts');
    expect(rules[0]!.negate).toBe(false);
  });

  it('parses negation rules', () => {
    const rules = parseGraphifyIgnore('!important.ts');
    expect(rules[0]!.negate).toBe(true);
  });

  it('marks anchored patterns (containing /)', () => {
    const anchored = parseGraphifyIgnore('src/generated/');
    const unanchored = parseGraphifyIgnore('generated');
    expect(anchored[0]!.anchored).toBe(true);
    expect(unanchored[0]!.anchored).toBe(false);
  });

  it('strips trailing slash from directory patterns', () => {
    const rules = parseGraphifyIgnore('dist/');
    expect(rules[0]!.pattern).toBe('dist');
  });

  it('parses multiple rules preserving order', () => {
    const rules = parseGraphifyIgnore('*.gen.ts\n!keep.gen.ts\ndist/');
    expect(rules).toHaveLength(3);
    expect(rules[0]!.negate).toBe(false);
    expect(rules[1]!.negate).toBe(true);
    expect(rules[2]!.pattern).toBe('dist');
  });
});

describe('shouldIgnoreByGraphifyIgnore', () => {
  it('returns false when no rules', () => {
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/auth.ts', REPO, [])).toBe(false);
  });

  it('ignores files matching a simple extension pattern', () => {
    const rules = parseGraphifyIgnore('*.generated.ts');
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/types.generated.ts', REPO, rules)).toBe(true);
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/types.ts', REPO, rules)).toBe(false);
  });

  it('unanchored pattern matches at any depth', () => {
    const rules = parseGraphifyIgnore('generated.ts');
    expect(shouldIgnoreByGraphifyIgnore('/repo/a/b/c/generated.ts', REPO, rules)).toBe(true);
    expect(shouldIgnoreByGraphifyIgnore('/repo/generated.ts', REPO, rules)).toBe(true);
  });

  it('anchored pattern matches from repo root', () => {
    const rules = parseGraphifyIgnore('src/generated/');
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/generated/foo.ts', REPO, rules)).toBe(true);
    expect(shouldIgnoreByGraphifyIgnore('/repo/lib/generated/foo.ts', REPO, rules)).toBe(false);
  });

  it('negation un-ignores a file', () => {
    // ignore all *.gen.ts except keep.gen.ts
    const rules = parseGraphifyIgnore('*.gen.ts\n!keep.gen.ts');
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/foo.gen.ts', REPO, rules)).toBe(true);
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/keep.gen.ts', REPO, rules)).toBe(false);
  });

  it('last matching rule wins', () => {
    const rules = parseGraphifyIgnore('src/\n!src/important.ts');
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/foo.ts', REPO, rules)).toBe(true);
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/important.ts', REPO, rules)).toBe(false);
  });

  it('** matches multiple path segments', () => {
    const rules = parseGraphifyIgnore('**/migrations/**');
    expect(shouldIgnoreByGraphifyIgnore('/repo/db/migrations/001.ts', REPO, rules)).toBe(true);
    expect(shouldIgnoreByGraphifyIgnore('/repo/src/auth.ts', REPO, rules)).toBe(false);
  });

  it('? matches single character', () => {
    const rules = parseGraphifyIgnore('v?.ts');
    expect(shouldIgnoreByGraphifyIgnore('/repo/v1.ts', REPO, rules)).toBe(true);
    expect(shouldIgnoreByGraphifyIgnore('/repo/v12.ts', REPO, rules)).toBe(false);
  });
});

describe('loadGraphifyIgnore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-ignore-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when file does not exist', () => {
    expect(loadGraphifyIgnore(tmpDir)).toHaveLength(0);
  });

  it('loads and parses .graphifyignore from repo root', () => {
    fs.writeFileSync(path.join(tmpDir, '.graphifyignore'), '*.gen.ts\ndist/\n');
    const rules = loadGraphifyIgnore(tmpDir);
    expect(rules).toHaveLength(2);
  });

  it('ignores read errors gracefully', () => {
    // Passing a non-directory path — should not throw
    expect(() => loadGraphifyIgnore('/nonexistent/path')).not.toThrow();
  });
});
