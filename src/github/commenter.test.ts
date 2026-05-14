import { formatPRComment, formatDependencyDiff, formatSuggestedReviewers } from './commenter';

const PR = { number: 42, title: 'Add auth middleware', author: 'mohan', baseBranch: 'main', headBranch: 'feat/auth' };

const FILES = [
  { path: 'src/auth/service.ts', rating: 8, directDependents: 2, fragileDependents: 0, errors: 0, warnings: 1 },
  { path: 'src/db/pool.ts', rating: 3, directDependents: 5, fragileDependents: 3, errors: 2, warnings: 3 },
  { path: 'src/utils/logger.ts', rating: 9, directDependents: 0, fragileDependents: 0, errors: 0, warnings: 0 },
];

describe('formatPRComment', () => {
  it('returns body and verdict', () => {
    const result = formatPRComment(PR, FILES, 'my-repo', 100);
    expect(result).toHaveProperty('body');
    expect(result).toHaveProperty('verdict');
  });

  it('verdict is request-changes when red files present', () => {
    const result = formatPRComment(PR, FILES, 'my-repo', 100);
    expect(result.verdict).toBe('request-changes');
  });

  it('verdict is approve when all green', () => {
    const clean = [FILES[0]!, FILES[2]!]; // rating 8 and 9, no fragile
    const result = formatPRComment(PR, clean, 'my-repo', 100);
    expect(result.verdict).toBe('approve');
  });

  it('includes PR number and title in body', () => {
    const result = formatPRComment(PR, [], 'my-repo', 50);
    expect(result.body).toContain('#42');
    expect(result.body).toContain('Add auth middleware');
  });

  it('includes author and branch info', () => {
    const result = formatPRComment(PR, [], 'my-repo', 50);
    expect(result.body).toContain('mohan');
    expect(result.body).toContain('feat/auth');
    expect(result.body).toContain('main');
    expect(result.body).toContain('Branch');
  });

  it('includes file count in codebase context', () => {
    const result = formatPRComment(PR, FILES, 'my-repo', 247);
    expect(result.body).toContain('247 analyzed files');
  });

  it('generates risk table rows for each file', () => {
    const result = formatPRComment(PR, FILES, 'my-repo', 100);
    expect(result.body).toContain('auth/service.ts');
    expect(result.body).toContain('db/pool.ts');
    expect(result.body).toContain('utils/logger.ts');
  });

  it('marks high-risk file with HIGH label', () => {
    const result = formatPRComment(PR, FILES, 'my-repo', 100);
    expect(result.body).toContain('HIGH');
  });

  it('shows verification suggestions when dependents exist', () => {
    const result = formatPRComment(PR, FILES, 'my-repo', 100);
    expect(result.body).toContain('get_impact_set');
  });
});

describe('formatDependencyDiff', () => {
  const added = [
    { source: 'src/auth/service.ts', target: 'src/db/pool.ts', type: 'IMPORT' },
  ];
  const removed = [
    { source: 'src/old/api.ts', target: 'src/db/legacy.ts', type: 'IMPORT' },
  ];

  it('lists added dependencies', () => {
    const result = formatDependencyDiff(added, []);
    expect(result).toContain('Added (1)');
    expect(result).toContain('auth/service.ts');
  });

  it('lists removed dependencies', () => {
    const result = formatDependencyDiff([], removed);
    expect(result).toContain('Removed (1)');
    expect(result).toContain('old/api.ts');
  });

  it('shows no change message when both empty', () => {
    const result = formatDependencyDiff([], []);
    expect(result).toContain('No dependency changes');
  });
});

describe('formatSuggestedReviewers', () => {
  const prFiles = [
    { filename: 'src/auth/service.ts', status: 'modified' as const, additions: 10, deletions: 2 },
  ];
  const owners = new Map([
    ['src/auth/', ['alice', 'bob']],
  ]);

  it('returns formatted reviewer list', () => {
    const result = formatSuggestedReviewers(prFiles, owners, '/repo');
    expect(result).toContain('Suggested Reviewers');
  });

  it('shows no ownership message when empty', () => {
    const result = formatSuggestedReviewers(prFiles, new Map(), '/repo');
    expect(result).toContain('No ownership data');
  });
});
