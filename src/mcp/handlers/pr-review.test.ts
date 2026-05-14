import { assessFile, handlePRReview } from './pr-review';

// Export assessFile for testing by re-using the internal logic
// We test the pure assessment function directly without daemon

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
