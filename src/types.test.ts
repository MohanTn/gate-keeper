import type { Language, Metrics, Violation, FileAnalysis, GraphData, WSMessage } from './types';

describe('Type Definitions', () => {
  it('should support all language types', () => {
    const languages: Language[] = ['csharp', 'typescript', 'tsx', 'jsx'];
    expect(languages.length).toBe(4);
    expect(languages).toContain('typescript');
  });

  it('should define Metrics structure correctly', () => {
    const metrics: Metrics = {
      linesOfCode: 150,
      cyclomaticComplexity: 5,
      numberOfMethods: 3,
      numberOfClasses: 1,
      importCount: 8,
      coveragePercent: 85,
    };
    expect(metrics.linesOfCode).toBeGreaterThan(0);
    expect(metrics.cyclomaticComplexity).toBeGreaterThan(0);
  });

  it('should define Violation with valid severity levels', () => {
    const violation: Violation = {
      type: 'missing_key',
      severity: 'error',
      message: 'Missing key prop in map',
      line: 42,
      fix: 'Add key={index} to JSX element',
    };
    expect(['error', 'warning', 'info']).toContain(violation.severity);
  });

  it('should define FileAnalysis structure correctly', () => {
    const analysis: FileAnalysis = {
      path: '/path/to/file.ts',
      language: 'typescript',
      dependencies: [],
      metrics: {
        linesOfCode: 100,
        cyclomaticComplexity: 2,
        numberOfMethods: 5,
        numberOfClasses: 1,
        importCount: 3,
      },
      violations: [],
      rating: 8.5,
      analyzedAt: Date.now(),
    };
    expect(analysis.rating).toBeGreaterThanOrEqual(0);
    expect(analysis.rating).toBeLessThanOrEqual(10);
  });

  it('should define GraphData structure correctly', () => {
    const graphData: GraphData = { nodes: [], edges: [] };
    expect(Array.isArray(graphData.nodes)).toBe(true);
    expect(Array.isArray(graphData.edges)).toBe(true);
  });

  it('should define WSMessage types', () => {
    const messageTypes = ['init', 'update', 'analysis_complete', 'error', 'scan_start', 'scan_progress', 'scan_complete', 'scan_log', 'repo_list', 'repo_created'];
    expect(messageTypes.length).toBeGreaterThan(0);
  });
});