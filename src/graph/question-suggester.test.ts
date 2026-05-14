import { suggestQuestions } from './question-suggester';

const REPO = '/repo';

const nodes = [
  { id: '/repo/src/auth/service.ts', label: 'service.ts', rating: 9 },
  { id: '/repo/src/database/pool.ts', label: 'pool.ts', rating: 3 },
  { id: '/repo/src/utils/logger.ts', label: 'logger.ts', rating: 7 },
  { id: '/repo/src/api/router.ts', label: 'router.ts', rating: 8 },
];

const edges = [
  { source: '/repo/src/auth/service.ts', target: '/repo/src/database/pool.ts' },
  { source: '/repo/src/api/router.ts', target: '/repo/src/auth/service.ts' },
  { source: '/repo/src/api/router.ts', target: '/repo/src/utils/logger.ts' },
];

describe('suggestQuestions', () => {
  it('returns questions for a normal graph', () => {
    const qs = suggestQuestions(nodes, edges, REPO);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThanOrEqual(5);
  });

  it('returns empty for empty nodes', () => {
    expect(suggestQuestions([], [], REPO)).toHaveLength(0);
  });

  it('each question has required fields', () => {
    const qs = suggestQuestions(nodes, edges, REPO);
    for (const q of qs) {
      expect(q).toHaveProperty('question');
      expect(q).toHaveProperty('type');
      expect(q).toHaveProperty('tool');
      expect(q).toHaveProperty('params');
    }
  });

  it('respects maxQuestions limit', () => {
    const qs = suggestQuestions(nodes, edges, REPO, 2);
    expect(qs).toHaveLength(2);
  });

  it('generates impact question for high-centrality node', () => {
    const qs = suggestQuestions(nodes, edges, REPO);
    const impactQ = qs.find(q => q.type === 'impact');
    expect(impactQ).toBeDefined();
    expect(impactQ!.tool).toBe('get_impact_set');
  });

  it('generates health question for low-rated file', () => {
    const qs = suggestQuestions(nodes, edges, REPO);
    const healthQ = qs.find(q => q.type === 'health');
    expect(healthQ).toBeDefined();
    // Should reference the worst-rated file (pool.ts, rating 3)
    expect(healthQ!.params['file_path']).toContain('pool.ts');
  });

  it('generates path question between god node and worst file', () => {
    const qs = suggestQuestions(nodes, edges, REPO);
    const pathQ = qs.find(q => q.type === 'path');
    expect(pathQ).toBeDefined();
    expect(pathQ!.tool).toBe('trace_path');
  });

  it('works with single node', () => {
    const qs = suggestQuestions(
      [{ id: '/repo/src/main.ts', label: 'main.ts', rating: 8 }],
      [],
      REPO,
    );
    expect(qs.length).toBeGreaterThanOrEqual(0);
  });
});
