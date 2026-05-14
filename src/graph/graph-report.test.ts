import { generateGraphReport } from './graph-report';

const REPO = '/repo';

const nodes = [
  { id: '/repo/src/auth/service.ts', label: 'service.ts', rating: 9, metrics: { linesOfCode: 120 } },
  { id: '/repo/src/database/pool.ts', label: 'pool.ts', rating: 3, metrics: { linesOfCode: 80 } },
  { id: '/repo/src/utils/logger.ts', label: 'logger.ts', rating: 7, metrics: { linesOfCode: 60 } },
  { id: '/repo/src/api/router.ts', label: 'router.ts', rating: 8, metrics: { linesOfCode: 200 } },
];

const edges = [
  { source: '/repo/src/auth/service.ts', target: '/repo/src/database/pool.ts' },
  { source: '/repo/src/api/router.ts', target: '/repo/src/auth/service.ts' },
  { source: '/repo/src/api/router.ts', target: '/repo/src/utils/logger.ts' },
];

const cycles = [{ nodes: ['/repo/src/auth/service.ts', '/repo/src/database/pool.ts'] }];

describe('generateGraphReport', () => {
  it('produces a non-empty markdown string', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(100);
  });

  it('includes repo name as heading', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(report).toContain('# Knowledge Graph: repo');
  });

  it('includes file and relationship counts', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(report).toContain('**Files:** 4');
    expect(report).toContain('**Relationships:** 3');
  });

  it('includes overall rating', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(report).toContain('7.5/10');
  });

  it('shows N/A when overall rating is null', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, null);
    expect(report).toContain('N/A/10');
  });

  it('includes god nodes section', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(report).toContain('God Nodes');
  });

  it('includes suggested questions', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(report).toContain('Suggested Questions');
  });

  it('includes architecture overview table', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(report).toContain('Architecture Overview');
    expect(report).toContain('| Module |');
  });

  it('warns about cycles when present', () => {
    const report = generateGraphReport(nodes, edges, cycles, REPO, 7.5);
    expect(report).toContain('circular dependency');
    expect(report).toContain('1 circular dependency cycle');
  });

  it('does not mention cycles when none', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(report).not.toContain('circular dependency');
  });

  it('works with empty graph', () => {
    const report = generateGraphReport([], [], [], REPO, null);
    expect(report).toContain('# Knowledge Graph');
    expect(report).toContain('**Files:** 0');
  });

  it('includes surprising connections section for cross-module edges', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5);
    expect(report).toContain('Surprising Connections');
  });

  it('respects topGodNodes option', () => {
    const report = generateGraphReport(nodes, edges, [], REPO, 7.5, { topGodNodes: 1 });
    const godSection = report.split('## God Nodes')[1]?.split('##')[0] ?? '';
    const entries = godSection.match(/^\d+\./gm) ?? [];
    expect(entries.length).toBeLessThanOrEqual(1);
  });
});
