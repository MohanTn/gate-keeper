import type { Language, Violation, Metrics, GraphNode, GraphData, FileAnalysis, WSMessage } from './types';

describe('Dashboard Types', () => {
  it('should support all language variants', () => {
    const languages: Language[] = ['csharp', 'typescript', 'tsx', 'jsx'];
    expect(languages).toContain('typescript');
    expect(languages).toContain('tsx');
  });

  it('should define Violation interface correctly', () => {
    const violation: Violation = {
      type: 'missing_key',
      severity: 'error',
      message: 'Missing key prop',
      line: 10,
      fix: 'Add key prop',
    };
    expect(['error', 'warning', 'info']).toContain(violation.severity);
  });

  it('should define Metrics interface correctly', () => {
    const metrics: Metrics = {
      linesOfCode: 100,
      cyclomaticComplexity: 3,
      numberOfMethods: 5,
      numberOfClasses: 1,
      importCount: 4,
    };
    expect(metrics.linesOfCode).toBeGreaterThan(0);
  });

  it('should define GraphNode structure correctly', () => {
    const node: GraphNode = {
      id: 'test.ts',
      label: 'test.ts',
      type: 'typescript',
      rating: 7.5,
      size: 100,
      violations: [],
      metrics: {
        linesOfCode: 100,
        cyclomaticComplexity: 2,
        numberOfMethods: 5,
        numberOfClasses: 1,
        importCount: 3,
      },
    };
    expect(node.rating).toBeGreaterThanOrEqual(0);
    expect(node.rating).toBeLessThanOrEqual(10);
  });

  it('should define GraphData structure correctly', () => {
    const data: GraphData = { nodes: [], edges: [] };
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
  });

  it('should define FileAnalysis interface correctly', () => {
    const analysis: FileAnalysis = {
      path: '/test.ts',
      language: 'typescript',
      rating: 8.0,
      violations: [],
      metrics: {
        linesOfCode: 100,
        cyclomaticComplexity: 2,
        numberOfMethods: 5,
        numberOfClasses: 1,
        importCount: 3,
      },
    };
    expect(analysis.rating).toBe(8.0);
  });

  it('should define WSMessage types', () => {
    const messageTypes = ['init', 'update', 'analysis_complete', 'error', 'scan_start', 'scan_progress', 'scan_complete'];
    expect(messageTypes.length).toBeGreaterThan(0);
  });
});
