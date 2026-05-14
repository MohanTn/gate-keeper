import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  postCommitScript,
  postCheckoutScript,
  mergeDriverScript,
  installGitHooks,
  gitAttributesEntry,
  gitConfigEntry,
} from './git-hooks';

const GK_DIR = '/opt/gate-keeper';

describe('postCommitScript', () => {
  it('returns a string starting with shebang', () => {
    const script = postCommitScript(GK_DIR);
    expect(script.startsWith('#!/bin/sh')).toBe(true);
  });

  it('references the hook-receiver path', () => {
    const script = postCommitScript(GK_DIR);
    expect(script).toContain('hook-receiver.js');
  });

  it('exits 0 when hook file not found', () => {
    const script = postCommitScript(GK_DIR);
    expect(script).toContain('exit 0');
  });
});

describe('postCheckoutScript', () => {
  it('returns a string starting with shebang', () => {
    const script = postCheckoutScript(GK_DIR);
    expect(script.startsWith('#!/bin/sh')).toBe(true);
  });

  it('checks BRANCH_CHECKOUT variable', () => {
    const script = postCheckoutScript(GK_DIR);
    expect(script).toContain('BRANCH_CHECKOUT');
  });
});

describe('mergeDriverScript', () => {
  it('returns a shell script', () => {
    const script = mergeDriverScript();
    expect(script.startsWith('#!/bin/sh')).toBe(true);
  });

  it('union-merges nodes', () => {
    const script = mergeDriverScript();
    expect(script).toContain('nodeMap');
  });
});

describe('gitAttributesEntry', () => {
  it('includes merge attribute for graph.json', () => {
    const entry = gitAttributesEntry();
    expect(entry).toContain('graph.json');
    expect(entry).toContain('merge=gate-keeper-graph');
  });
});

describe('gitConfigEntry', () => {
  it('includes merge section', () => {
    const entry = gitConfigEntry(GK_DIR);
    expect(entry).toContain('[merge "gate-keeper-graph"]');
  });

  it('includes driver path', () => {
    const entry = gitConfigEntry(GK_DIR);
    expect(entry).toContain('driver');
  });
});

describe('installGitHooks', () => {
  let tmpDir: string;
  let hooksDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-hooks-'));
    hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates post-commit and post-checkout hooks', () => {
    const results = installGitHooks(tmpDir, GK_DIR, true);
    expect(results).toHaveLength(2);
    const names = results.map(r => r.hook);
    expect(names).toContain('post-commit');
    expect(names).toContain('post-checkout');
  });

  it('marks hooks as created when new', () => {
    const results = installGitHooks(tmpDir, GK_DIR, false);
    expect(results.every(r => r.action === 'created')).toBe(true);
  });

  it('skips existing hooks without force', () => {
    fs.writeFileSync(path.join(hooksDir, 'post-commit'), '#!/bin/sh\n');
    const results = installGitHooks(tmpDir, GK_DIR, false);
    const postCommit = results.find(r => r.hook === 'post-commit');
    expect(postCommit?.action).toBe('skipped');
  });

  it('updates existing hooks with force=true', () => {
    fs.writeFileSync(path.join(hooksDir, 'post-commit'), '#!/bin/sh\n');
    const results = installGitHooks(tmpDir, GK_DIR, true);
    const postCommit = results.find(r => r.hook === 'post-commit');
    expect(postCommit?.action).toBe('updated');
  });

  it('throws when .git/hooks does not exist', () => {
    const noGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-nogit-'));
    expect(() => installGitHooks(noGitDir, GK_DIR)).toThrow('No .git/hooks directory');
    fs.rmSync(noGitDir, { recursive: true, force: true });
  });

  it('writes executable file (mode includes execute bit)', () => {
    installGitHooks(tmpDir, GK_DIR, false);
    const stat = fs.statSync(path.join(hooksDir, 'post-commit'));
    // 0o100755 = regular executable file; check user-execute bit
    expect(stat.mode & 0o100).toBeTruthy();
  });
});
