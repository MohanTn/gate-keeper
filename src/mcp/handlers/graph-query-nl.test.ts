/**
 * Tests for the query_graph NL pattern matcher.
 *
 * Tests the pure function `resolveQueryPattern` directly without needing a
 * running daemon. Graph data is constructed inline as a fixture.
 */

import { resolveQueryPattern } from './graph-intelligence';

const REPO = '/repo';

const nodes = [
  { id: '/repo/src/auth/service.ts', label: 'service.ts', type: 'typescript' as const, rating: 8, size: 1, violations: [], metrics: { linesOfCode: 120, cyclomaticComplexity: 5, numberOfMethods: 4, numberOfClasses: 1, importCount: 3 } },
  { id: '/repo/src/database/pool.ts', label: 'pool.ts', type: 'typescript' as const, rating: 4, size: 1, violations: [{ type: 'any_type', severity: 'warning' as const, message: 'using any' }], metrics: { linesOfCode: 200, cyclomaticComplexity: 12, numberOfMethods: 6, numberOfClasses: 2, importCount: 5 } },
  { id: '/repo/src/utils/logger.ts', label: 'logger.ts', type: 'typescript' as const, rating: 9, size: 1, violations: [], metrics: { linesOfCode: 50, cyclomaticComplexity: 2, numberOfMethods: 2, numberOfClasses: 0, importCount: 1 } },
  { id: '/repo/src/api/router.ts', label: 'router.ts', type: 'typescript' as const, rating: 7, size: 1, violations: [], metrics: { linesOfCode: 180, cyclomaticComplexity: 6, numberOfMethods: 5, numberOfClasses: 1, importCount: 4 } },
  { id: '/repo/src/middleware/auth.ts', label: 'auth.ts', type: 'typescript' as const, rating: 6, size: 1, violations: [], metrics: { linesOfCode: 90, cyclomaticComplexity: 4, numberOfMethods: 3, numberOfClasses: 0, importCount: 2 } },
];

const edges = [
  { source: '/repo/src/api/router.ts', target: '/repo/src/auth/service.ts', type: 'import', strength: 1 },
  { source: '/repo/src/auth/service.ts', target: '/repo/src/database/pool.ts', type: 'import', strength: 1 },
  { source: '/repo/src/api/router.ts', target: '/repo/src/utils/logger.ts', type: 'import', strength: 1 },
  { source: '/repo/src/middleware/auth.ts', target: '/repo/src/auth/service.ts', type: 'import', strength: 1 },
];

const graph = { nodes, edges };

describe('resolveQueryPattern', () => {
  it('matches god node / hotspot queries', () => {
    const answer = resolveQueryPattern('what are the god nodes?', graph, REPO);
    expect(answer).not.toBeNull();
    expect(answer!).toContain('connections');
    // Top-centrality node should be mentioned
    expect(answer!).toContain('auth/service');
  });

  it('matches centrality / blast radius queries', () => {
    const answer = resolveQueryPattern('highest blast radius files', graph, REPO);
    expect(answer).not.toBeNull();
  });

  it('matches surprising connections queries', () => {
    const answer = resolveQueryPattern('show me surprising connections between modules', graph, REPO);
    expect(answer).not.toBeNull();
    // With cross-module edges, should find some
    expect(answer!.length).toBeGreaterThan(0);
  });

  it('matches health / quality queries', () => {
    // Pattern: (health|quality|rating).*(worst|bad|poor|low)
    const answer = resolveQueryPattern('show me the health of worst files', graph, REPO);
    expect(answer).not.toBeNull();
    // database/pool has rating 4 — should be listed as worst
    expect(answer!).toContain('pool.ts');
    expect(answer!).toContain('4/10');
  });

  it('matches break / impact queries', () => {
    const answer = resolveQueryPattern('what would break if I change service.ts', graph, REPO);
    expect(answer).not.toBeNull();
    expect(answer!).toContain('Most at-risk');
  });

  it('matches import / dependency queries', () => {
    const answer = resolveQueryPattern('what files depend on service.ts', graph, REPO);
    expect(answer).not.toBeNull();
    expect(answer!).toContain('Most-imported');
  });

  it('matches explain queries', () => {
    const answer = resolveQueryPattern('explain pool.ts', graph, REPO);
    expect(answer).not.toBeNull();
    // Should find pool.ts and describe it
    expect(answer!).toContain('pool.ts');
    expect(answer!).toContain('rating');
  });

  it('matches suggestion / question queries', () => {
    const answer = resolveQueryPattern('suggest questions about my codebase', graph, REPO);
    expect(answer).not.toBeNull();
    // Should produce numbered questions
    expect(answer!).toMatch(/^\d+\./m);
  });

  it('returns null for unrecognised queries', () => {
    const answer = resolveQueryPattern('zzznotamatchxyz', graph, REPO);
    expect(answer).toBeNull();
  });

  it('matches cross-module queries', () => {
    const answer = resolveQueryPattern('unexpected cross module dependencies', graph, REPO);
    expect(answer).not.toBeNull();
  });

  it('matches connection / path queries', () => {
    const answer = resolveQueryPattern('what connects router to database', graph, REPO);
    expect(answer).not.toBeNull();
    expect(answer!).toContain('trace_path');
  });

  it('handles empty graph gracefully', () => {
    const emptyGraph = { nodes: [], edges: [] };
    const answer = resolveQueryPattern('what are the god nodes?', emptyGraph, REPO);
    // Should not crash — returns a message about no files
    expect(answer).not.toBeNull();
  });

  it('handles single-node graph', () => {
    const single = { nodes: [nodes[0]!], edges: [] };
    const answer = resolveQueryPattern('health of worst', single, REPO);
    expect(answer).not.toBeNull();
    // Should mention the single node's rating
    expect(answer!).toContain('/10');
  });

  it('matches health query returning violations info', () => {
    // pool.ts has 1 warning, service.ts has 0 — the health query should mention violations
    const answer = resolveQueryPattern('quality check on poor files', graph, REPO);
    expect(answer).not.toBeNull();
    expect(answer!).toContain('violations');
  });

  it('explain query with descriptive terms finds the correct file', () => {
    const answer = resolveQueryPattern('tell me about logger', graph, REPO);
    expect(answer).not.toBeNull();
    expect(answer!).toContain('logger');
    expect(answer!).toContain('9');
  });
});
