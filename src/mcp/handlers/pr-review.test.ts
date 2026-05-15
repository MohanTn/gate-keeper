import { assessFile, handlePRReview } from './pr-review';
import { spawnSync } from 'child_process';

// Export assessFile for testing by re-using the internal logic
// We test the pure assessment function directly without daemon

// Mock helpers module for handlePRReview tests
// NOTE: jest.mock is hoisted, so this applies before all imports.
// Existing assessFile tests don't use helpers, so they're unaffected.
jest.mock('../helpers', () => ({
  fetchDaemonApi: jest.fn(),
  findGitRoot: jest.fn(() => '/repo'),
}));

// Mock child_process for getChangedFilesFromGit tests
// Default: return empty/stdout / error status (like HEAD~1 does not exist)
jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({ status: 1, stdout: '' })),
}));

// Build a minimal graph fixture for testing
const REPO = '/repo';

const graphNodes = [
  { id: '/repo/src/auth.ts', label: 'auth.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 4, numberOfClasses: 1, importCount: 3 } },
  { id: '/repo/src/db.ts', label: 'db.ts', type: 'typescript' as const, rating: 4, size: 1, violations: [], metrics: { linesOfCode: 200, cyclomaticComplexity: 8, numberOfMethods: 6, numberOfClasses: 2, importCount: 5 } },
  { id: '/repo/src/utils.ts', label: 'utils.ts', type: 'typescript' as const, rating: 9, size: 1, violations: [], metrics: { linesOfCode: 50, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
  { id: '/repo/src/api.ts', label: 'api.ts', type: 'typescript' as const, rating: 7, size: 1, violations: [], metrics: { linesOfCode: 150, cyclomaticComplexity: 6, numberOfMethods: 5, numberOfClasses: 1, importCount: 4 } },
  { id: '/repo/src/middleware.ts', label: 'middleware.ts', type: 'typescript' as const, rating: 5, size: 1, violations: [], metrics: { linesOfCode: 80, cyclomaticComplexity: 4, numberOfMethods: 3, numberOfClasses: 0, importCount: 2 } },
];

const graphEdges = [
  // auth.ts is imported by api.ts and middleware.ts (2 dependents)
  { source: '/repo/src/api.ts', target: '/repo/src/auth.ts', type: 'import', strength: 1 },
  { source: '/repo/src/middleware.ts', target: '/repo/src/auth.ts', type: 'import', strength: 1 },
  // db.ts is imported by auth.ts and api.ts
  { source: '/repo/src/auth.ts', target: '/repo/src/db.ts', type: 'import', strength: 1 },
  { source: '/repo/src/api.ts', target: '/repo/src/db.ts', type: 'import', strength: 1 },
];

const graph = { nodes: graphNodes, edges: graphEdges };

// Import helpers to test assessFile
import { buildReverseAdjacency } from '../../graph/graph-algorithms';

function makeRatingMap(nodes: typeof graphNodes): Map<string, number> {
  return new Map(nodes.map(n => [n.id, n.rating]));
}

describe('assessFile', () => {
  const revAdj = buildReverseAdjacency(graphEdges);
  const ratings = makeRatingMap(graphNodes);

  it('gives GREEN to a healthy leaf node', () => {
    const result = assessFile('/repo/src/utils.ts', graph, revAdj, ratings);
    expect(result.verdict).toBe('GREEN');
    expect(result.rating).toBe(9);
  });

  it('gives YELLOW to a file with moderate dependents', () => {
    const result = assessFile('/repo/src/auth.ts', graph, revAdj, ratings);
    // auth.ts has 2 direct dependents; rating 8 is OK, but middleware.ts (rating 5) is fragile
    expect(['YELLOW', 'GREEN']).toContain(result.verdict);
  });

  it('gives RED to a low-rated file', () => {
    const result = assessFile('/repo/src/db.ts', graph, revAdj, ratings);
    expect(result.verdict).toBe('RED');
    expect(result.rating).toBe(4);
  });

  it('returns null rating for unknown file', () => {
    const result = assessFile('/repo/src/unknown.ts', graph, revAdj, ratings);
    expect(result.rating).toBeNull();
  });

  it('includes reasons array', () => {
    const result = assessFile('/repo/src/auth.ts', graph, revAdj, ratings);
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('counts direct dependents correctly', () => {
    const result = assessFile('/repo/src/auth.ts', graph, revAdj, ratings);
    expect(result.directDependents).toBe(2); // api.ts and middleware.ts
  });
});

describe('PRReviewResult shape', () => {
  // Test the shape/types of the result rather than full handler (which needs daemon)
  it('FileRisk has required fields', () => {
    const revAdj = buildReverseAdjacency(graphEdges);
    const ratings = makeRatingMap(graphNodes);
    const result = assessFile('/repo/src/db.ts', graph, revAdj, ratings);

    expect(result).toHaveProperty('file');
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('rating');
    expect(result).toHaveProperty('directDependents');
    expect(result).toHaveProperty('fragileImpacted');
    expect(result).toHaveProperty('reasons');
  });

  it('verdict is one of GREEN/YELLOW/RED', () => {
    const revAdj = buildReverseAdjacency(graphEdges);
    const ratings = makeRatingMap(graphNodes);
    for (const node of graphNodes) {
      const result = assessFile(node.id, graph, revAdj, ratings);
      expect(['GREEN', 'YELLOW', 'RED']).toContain(result.verdict);
    }
  });
});

// ── Additional assessFile edge cases ──────────────────────────

describe('assessFile — rating thresholds', () => {
  const revAdj = buildReverseAdjacency(graphEdges);
  const ratings = makeRatingMap(graphNodes);

  it('gives YELLOW for rating between 5 and 7', () => {
    const result = assessFile('/repo/src/middleware.ts', graph, revAdj, ratings);
    // middleware has rating 5, which is < 7 but >= 5
    expect(result.verdict).toBe('YELLOW');
    expect(result.rating).toBe(5);
    expect(result.reasons).toContain('Below-threshold quality (rating 5/10)');
  });

  it('gives GREEN with "Healthy file" for rating >= 7', () => {
    const result = assessFile('/repo/src/api.ts', graph, revAdj, ratings);
    // api.ts has rating 7, 2 direct dependents but none fragile
    expect(result.verdict).toBe('GREEN');
    expect(result.reasons[0]).toContain('Healthy file');
  });

  it('gives GREEN with "Not yet analyzed" for null rating file', () => {
    const result = assessFile('/repo/src/unknown.ts', graph, revAdj, ratings);
    expect(result.verdict).toBe('GREEN');
    expect(result.rating).toBeNull();
    expect(result.reasons).toContain('Not yet analyzed');
  });
});

describe('assessFile — fragile dependents', () => {
  // Build a smaller graph where fragileThreshold matters
  const nodes = [
    { id: '/repo/src/core.ts', label: 'core.ts', type: 'typescript' as const, rating: 7, size: 1, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 4, numberOfClasses: 1, importCount: 3 } },
    { id: '/repo/src/fragile1.ts', label: 'fragile1.ts', type: 'typescript' as const, rating: 4, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
    { id: '/repo/src/fragile2.ts', label: 'fragile2.ts', type: 'typescript' as const, rating: 5, size: 1, violations: [], metrics: { linesOfCode: 40, cyclomaticComplexity: 3, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
    { id: '/repo/src/fragile3.ts', label: 'fragile3.ts', type: 'typescript' as const, rating: 3, size: 1, violations: [], metrics: { linesOfCode: 20, cyclomaticComplexity: 1, numberOfMethods: 1, numberOfClasses: 0, importCount: 1 } },
    { id: '/repo/src/healthy.ts', label: 'healthy.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 60, cyclomaticComplexity: 3, numberOfMethods: 3, numberOfClasses: 0, importCount: 2 } },
  ];

  // core.ts is imported by fragile1, fragile2, fragile3, healthy
  const edges = [
    { source: '/repo/src/fragile1.ts', target: '/repo/src/core.ts', type: 'import' as const, strength: 1 },
    { source: '/repo/src/fragile2.ts', target: '/repo/src/core.ts', type: 'import' as const, strength: 1 },
    { source: '/repo/src/fragile3.ts', target: '/repo/src/core.ts', type: 'import' as const, strength: 1 },
    { source: '/repo/src/healthy.ts', target: '/repo/src/core.ts', type: 'import' as const, strength: 1 },
  ];

  const g = { nodes, edges };
  const revAdj = buildReverseAdjacency(edges);
  const ratings = new Map(nodes.map(n => [n.id, n.rating]));

  it('gives RED when fragileImpacted >= 3', () => {
    const result = assessFile('/repo/src/core.ts', g, revAdj, ratings);
    expect(result.verdict).toBe('RED');
    expect(result.fragileImpacted).toBe(3); // fragile1, fragile2, fragile3 (rating < 6)
    expect(result.directDependents).toBe(4);
    expect(result.reasons).toContain('3 fragile dependents (rating<6) will be impacted');
  });

  it('gives YELLOW when fragileImpacted >= 1 but < 3', () => {
    // Build graph where exactly 1 fragile dependent
    const smallNodes = [
      { id: '/repo/src/moderate.ts', label: 'moderate.ts', type: 'typescript' as const, rating: 7, size: 1, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 4, numberOfClasses: 1, importCount: 3 } },
      { id: '/repo/src/fragile.ts', label: 'fragile.ts', type: 'typescript' as const, rating: 4, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
      { id: '/repo/src/robust.ts', label: 'robust.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 50, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
    ];
    const smallEdges = [
      { source: '/repo/src/fragile.ts', target: '/repo/src/moderate.ts', type: 'import' as const, strength: 1 },
      { source: '/repo/src/robust.ts', target: '/repo/src/moderate.ts', type: 'import' as const, strength: 1 },
    ];
    const sg = { nodes: smallNodes, edges: smallEdges };
    const sRevAdj = buildReverseAdjacency(smallEdges);
    const sRatings = new Map(smallNodes.map(n => [n.id, n.rating]));

    const result = assessFile('/repo/src/moderate.ts', sg, sRevAdj, sRatings);
    expect(result.verdict).toBe('YELLOW');
    expect(result.fragileImpacted).toBe(1);
    expect(result.reasons).toContain('1 fragile dependent(s) may be impacted');
  });
});

describe('assessFile — god node with many dependents', () => {
  // Build a "god" node with 10 direct dependents
  const NUM_DEPS = 10;
  const deps = Array.from({ length: NUM_DEPS }, (_, i) => ({
    id: `/repo/src/dep${i}.ts`,
    label: `dep${i}.ts`,
    type: 'typescript' as const,
    rating: 8,
    size: 1,
    violations: [],
    metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 },
  }));

  const nodes = [
    { id: '/repo/src/god.ts', label: 'god.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 200, cyclomaticComplexity: 10, numberOfMethods: 8, numberOfClasses: 2, importCount: 15 } },
    ...deps,
  ];

  const edges = deps.map(d => ({
    source: d.id,
    target: '/repo/src/god.ts',
    type: 'import' as const,
    strength: 1,
  }));

  const g = { nodes, edges };
  const revAdj = buildReverseAdjacency(edges);
  const ratings = new Map(nodes.map(n => [n.id, n.rating]));

  it('gives RED when directDependents >= 10', () => {
    const result = assessFile('/repo/src/god.ts', g, revAdj, ratings);
    expect(result.verdict).toBe('RED');
    expect(result.directDependents).toBe(10);
    expect(result.reasons).toContain('God node — 10 direct dependents');
  });
});

describe('assessFile — combination cases', () => {
  it('gives YELLOW for directDependents >= 3 when not already RED', () => {
    // Build file with 3 dependents, rating >= 7, no fragile
    const nodes = [
      { id: '/repo/src/popular.ts', label: 'popular.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 4, numberOfClasses: 1, importCount: 3 } },
      { id: '/repo/src/dep_a.ts', label: 'dep_a.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
      { id: '/repo/src/dep_b.ts', label: 'dep_b.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
      { id: '/repo/src/dep_c.ts', label: 'dep_c.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
    ];
    const edges = [
      { source: '/repo/src/dep_a.ts', target: '/repo/src/popular.ts', type: 'import' as const, strength: 1 },
      { source: '/repo/src/dep_b.ts', target: '/repo/src/popular.ts', type: 'import' as const, strength: 1 },
      { source: '/repo/src/dep_c.ts', target: '/repo/src/popular.ts', type: 'import' as const, strength: 1 },
    ];
    const revAdj = buildReverseAdjacency(edges);
    const ratings = new Map(nodes.map(n => [n.id, n.rating]));

    const result = assessFile('/repo/src/popular.ts', { nodes, edges }, revAdj, ratings);
    expect(result.verdict).toBe('YELLOW');
    expect(result.directDependents).toBe(3);
    expect(result.reasons).toContain('3 direct dependents');
  });

  it('combines multiple reasons for RED file', () => {
    // Low rating + fragile dependents + many dependents
    const nodes = [
      { id: '/repo/src/disaster.ts', label: 'disaster.ts', type: 'typescript' as const, rating: 3, size: 1, violations: [], metrics: { linesOfCode: 200, cyclomaticComplexity: 20, numberOfMethods: 15, numberOfClasses: 3, importCount: 10 } },
      { id: '/repo/src/dep1.ts', label: 'dep1.ts', type: 'typescript' as const, rating: 4, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
      { id: '/repo/src/dep2.ts', label: 'dep2.ts', type: 'typescript' as const, rating: 5, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
      { id: '/repo/src/dep3.ts', label: 'dep3.ts', type: 'typescript' as const, rating: 5, size: 1, violations: [], metrics: { linesOfCode: 30, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
    ];
    const edges = [
      { source: '/repo/src/dep1.ts', target: '/repo/src/disaster.ts', type: 'import' as const, strength: 1 },
      { source: '/repo/src/dep2.ts', target: '/repo/src/disaster.ts', type: 'import' as const, strength: 1 },
      { source: '/repo/src/dep3.ts', target: '/repo/src/disaster.ts', type: 'import' as const, strength: 1 },
    ];
    const revAdj = buildReverseAdjacency(edges);
    const ratings = new Map(nodes.map(n => [n.id, n.rating]));

    const result = assessFile('/repo/src/disaster.ts', { nodes, edges }, revAdj, ratings);
    expect(result.verdict).toBe('RED');
    expect(result.reasons).toContain('Low quality file (rating 3/10)');
    expect(result.reasons).toContain('3 fragile dependents (rating<6) will be impacted');
  });
});

// ── ratingMap (indirect through handlePRReview with mocked daemon) ──

describe('handlePRReview', () => {
  let fetchDaemonApiMock: jest.Mock;

  beforeAll(() => {
    // Import the mocked fetchDaemonApi — jest.mock is hoisted so this is the mock
    const helpers = require('../helpers');
    fetchDaemonApiMock = helpers.fetchDaemonApi as jest.Mock;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    fetchDaemonApiMock.mockResolvedValue(graph);
  });

  it('returns no-changed-files error when changed_files is empty', async () => {
    const result = await handlePRReview({ repo: '/repo', changed_files: [] });
    expect(result.content[0]?.text).toContain('No changed source files found');
    expect(fetchDaemonApiMock).not.toHaveBeenCalled();
  });

  it('returns daemon-unreachable error when fetchDaemonApi returns null', async () => {
    fetchDaemonApiMock.mockResolvedValue(null);

    const result = await handlePRReview({ repo: '/repo', changed_files: ['src/utils.ts'] });
    expect(result.content[0]?.text).toContain('Gate Keeper daemon is not running');
  });

  it('processes explicit changed_files and produces a GREEN overall verdict', async () => {
    const result = await handlePRReview({
      repo: '/repo',
      changed_files: ['src/utils.ts'],
    });

    expect(result.structuredContent).toBeDefined();
    const data = result.structuredContent!.data as Record<string, unknown>;
    expect(data.overallVerdict).toBe('GREEN');
    expect(data.changedFiles).toBe(1);
    expect(data.greenFiles).toBe(1);
    expect(data.redFiles).toBe(0);
    expect(data.yellowFiles).toBe(0);
    expect((data.fileRisks as unknown[]).length).toBe(1);
    expect(data.recommendation).toContain('Approve');
  });

  it('processes absolute paths and relative paths correctly', async () => {
    const result = await handlePRReview({
      repo: '/repo',
      changed_files: ['/repo/src/utils.ts', 'src/auth.ts'],
    });

    const data = result.structuredContent!.data as Record<string, unknown>;
    expect(data.changedFiles).toBe(2);
    const risks = data.fileRisks as Array<{ file: string }>;
    // Absolute path stays as-is, relative gets joined with repo
    expect(risks[0]!.file).toBe('/repo/src/utils.ts');
    expect(risks[1]!.file).toBe('/repo/src/auth.ts');
  });

  it('produces YELLOW verdict when medium-risk files exist', async () => {
    const result = await handlePRReview({
      repo: '/repo',
      changed_files: ['src/middleware.ts'], // rating 5 → YELLOW
    });

    const data = result.structuredContent!.data as Record<string, unknown>;
    expect(data.overallVerdict).toBe('YELLOW');
    expect(data.yellowFiles).toBe(1);
    expect(data.recommendation).toContain('Review carefully');
  });

  it('produces RED verdict when high-risk files exist', async () => {
    const result = await handlePRReview({
      repo: '/repo',
      changed_files: ['src/db.ts'], // rating 4 → RED
    });

    const data = result.structuredContent!.data as Record<string, unknown>;
    expect(data.overallVerdict).toBe('RED');
    expect(data.redFiles).toBe(1);
    expect(data.recommendation).toContain('Request changes');
  });

  it('shows worst files section for RED files in text output', async () => {
    const result = await handlePRReview({
      repo: '/repo',
      changed_files: ['src/db.ts'],
    });

    const text = result.content[0]?.text;
    expect(text).toContain('Action required for RED files');
    expect(text).toContain('suggest_refactoring');
    expect(text).toContain('db.ts');
  });

  it('handles mixed verdicts across multiple files', async () => {
    const result = await handlePRReview({
      repo: '/repo',
      changed_files: ['src/utils.ts', 'src/middleware.ts', 'src/db.ts'],
    });

    const data = result.structuredContent!.data as Record<string, unknown>;
    expect(data.changedFiles).toBe(3);
    expect(data.greenFiles).toBe(1); // utils.ts (rating 9)
    expect(data.yellowFiles).toBe(1); // middleware.ts (rating 5)
    expect(data.redFiles).toBe(1); // db.ts (rating 4)
    expect(data.overallVerdict).toBe('RED'); // red > 0 → overall RED
    expect(data.recommendation).toContain('Request changes');
  });

  it('includes file details in the markdown table', async () => {
    const result = await handlePRReview({
      repo: '/repo',
      changed_files: ['src/db.ts'],
    });

    const text = result.content[0]?.text;
    expect(text).toContain('db.ts');
    expect(text).toContain('4/10');
    expect(text).toContain('🔴 RED');
  });

  it('uses getChangedFilesFromGit when no changed_files provided', async () => {
    (spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: 'src/utils.ts\nsrc/middleware.ts\n',
    });

    fetchDaemonApiMock.mockResolvedValue(graph);

    const result = await handlePRReview({ repo: '/repo' });

    expect(spawnSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'HEAD~1', 'HEAD'],
      expect.objectContaining({ cwd: '/repo' }),
    );
    const data = result.structuredContent!.data as Record<string, unknown>;
    expect(data.changedFiles).toBe(2);
    expect(data.greenFiles).toBe(1); // utils.ts has rating 9
    expect(data.yellowFiles).toBe(1); // middleware.ts has rating 5
  });

  it('returns no-changed-files error when git diff returns empty', async () => {
    (spawnSync as jest.Mock).mockReturnValue({
      status: 0,
      stdout: '',
    });

    const result = await handlePRReview({ repo: '/repo' });

    expect(result.content[0]?.text).toContain('No changed source files found');
  });

  it('returns no-changed-files error when git diff fails', async () => {
    (spawnSync as jest.Mock).mockReturnValue({
      status: 1,
      stdout: '',
    });

    const result = await handlePRReview({ repo: '/repo' });

    expect(result.content[0]?.text).toContain('No changed source files found');
  });
});
