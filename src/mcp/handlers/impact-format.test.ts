/**
 * Impact Format Helper Tests
 *
 * Tests for the rendering helpers used by impact analysis handlers.
 * These focus on the edge-case branches not exercised by the
 * daemon-mocked handler tests in server.test.ts.
 */

import { GraphResponse } from './types';

// ── Mock graph data ──────────────────────────────────────────

const mockGraph: GraphResponse = {
  nodes: [
    {
      id: '/test/healthy.ts',
      label: 'healthy.ts',
      type: 'typescript',
      rating: 8.0,
      size: 50,
      violations: [],
      metrics: { linesOfCode: 30, cyclomaticComplexity: 3, numberOfMethods: 2, numberOfClasses: 1, importCount: 1 },
    },
    {
      id: '/test/low-rated.ts',
      label: 'low-rated.ts',
      type: 'typescript',
      rating: 3.5,
      size: 200,
      violations: [{ type: 'any_usage', severity: 'warning', message: 'Use specific types' }],
      metrics: { linesOfCode: 150, cyclomaticComplexity: 25, numberOfMethods: 10, numberOfClasses: 1, importCount: 5 },
    },
  ],
  edges: [
    { source: '/test/healthy.ts', target: '/test/low-rated.ts', type: 'import', strength: 1 },
  ],
};

const emptyGraph: GraphResponse = { nodes: [], edges: [] };

// ── Tests ────────────────────────────────────────────────────

describe('renderDirectDependents', () => {
  let renderDirectDependents: typeof import('./impact-format').renderDirectDependents;

  beforeAll(async () => {
    renderDirectDependents = (await import('./impact-format')).renderDirectDependents;
  });

  it('should return empty array when no direct dependents', () => {
    const result = renderDirectDependents(emptyGraph, new Set(), '/test');
    expect(result).toEqual([]);
  });

  it('should render direct dependents with rating info', () => {
    const result = renderDirectDependents(mockGraph, new Set(['/test/low-rated.ts']), '/test');
    expect(result[0]).toBe('### Direct Dependents');
    expect(result.some(l => l.includes('low-rated.ts'))).toBe(true);
    expect(result.some(l => l.includes('3.5'))).toBe(true);
  });

  it('should handle dependents not in graph', () => {
    const result = renderDirectDependents(emptyGraph, new Set(['/test/missing.ts']), '/test');
    expect(result[0]).toBe('### Direct Dependents');
    expect(result.some(l => l.includes('missing.ts'))).toBe(true);
  });
});

describe('renderTransitiveDependents', () => {
  let renderTransitiveDependents: typeof import('./impact-format').renderTransitiveDependents;

  beforeAll(async () => {
    renderTransitiveDependents = (await import('./impact-format')).renderTransitiveDependents;
  });

  it('should return empty array when no transitive deps', () => {
    const result = renderTransitiveDependents(emptyGraph, [], '/test');
    expect(result).toEqual([]);
  });

  it('should render transitive dependents', () => {
    const result = renderTransitiveDependents(mockGraph, ['/test/low-rated.ts'], '/test');
    expect(result[0]).toBe('### Transitive Dependents');
    expect(result.some(l => l.includes('low-rated.ts'))).toBe(true);
  });

  it('should truncate at 20 with overflow message', () => {
    const many = Array.from({ length: 25 }, (_, i) => `/test/file${i}.ts`);
    const result = renderTransitiveDependents(mockGraph, many, '/test');
    expect(result.some(l => l.includes('25 - 20') || l.includes('5 more'))).toBe(true);
  });
});

describe('renderAtRiskDependents', () => {
  let renderAtRiskDependents: typeof import('./impact-format').renderAtRiskDependents;

  beforeAll(async () => {
    renderAtRiskDependents = (await import('./impact-format')).renderAtRiskDependents;
  });

  it('should return empty when no at-risk dependents', () => {
    const healthyOnly = new Set(['/test/healthy.ts']);
    const result = renderAtRiskDependents(mockGraph, healthyOnly, '/test');
    expect(result).toEqual([]);
  });

  it('should render at-risk dependents with warnings', () => {
    const allDeps = new Set(['/test/healthy.ts', '/test/low-rated.ts']);
    const result = renderAtRiskDependents(mockGraph, allDeps, '/test');
    expect(result[0]).toContain('At-Risk Dependents');
    expect(result.some(l => l.includes('3.5'))).toBe(true);
    expect(result.some(l => l.includes('1 violations'))).toBe(true);
  });
});

describe('renderRemediationPlan', () => {
  let renderRemediationPlan: typeof import('./impact-format').renderRemediationPlan;

  beforeAll(async () => {
    renderRemediationPlan = (await import('./impact-format')).renderRemediationPlan;
  });

  it('should return empty when no dependents at all', async () => {
    const result = await renderRemediationPlan(emptyGraph, new Set(), [], '/test');
    expect(result).toEqual([]);
  });

  it('should return safe message when dependents are healthy', async () => {
    const healthyOnly = new Set(['/test/healthy.ts']);
    const result = await renderRemediationPlan(mockGraph, healthyOnly, [], '/test');
    expect(result.some(l => l.includes('safe'))).toBe(true);
  });

  it('should produce remediation plan for at-risk files', async () => {
    const allDeps = new Set(['/test/healthy.ts', '/test/low-rated.ts']);
    const result = await renderRemediationPlan(mockGraph, allDeps, [], '/test');
    expect(result[0]).toContain('Remediation Plan');
    expect(result.some(l => l.includes('low-rated.ts'))).toBe(true);
    expect(result.some(l => l.includes('3.5'))).toBe(true);
  });
});
