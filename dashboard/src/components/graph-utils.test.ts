import { healthColor, healthLabel, buildTooltip, makeNodeColor, edgeId } from './graph-utils';
import type { GraphNode } from '../types';
import { darkTokens } from '../ThemeContext';

describe('graph-utils', () => {
  it('should map health colors for different ratings', () => {
    const healthyColor = healthColor(8.5, darkTokens);
    expect(healthyColor).toBeTruthy();

    const warningColor = healthColor(7.0, darkTokens);
    expect(warningColor).toBeTruthy();

    const degradedColor = healthColor(5.0, darkTokens);
    expect(degradedColor).toBeTruthy();

    const criticalColor = healthColor(2.0, darkTokens);
    expect(criticalColor).toBeTruthy();
  });

  it('should generate health labels for ratings', () => {
    expect(healthLabel(9)).toBe('Healthy');
    expect(healthLabel(7)).toBe('Warning');
    expect(healthLabel(5)).toBe('Degraded');
    expect(healthLabel(2)).toBe('Critical');
  });

  it('should generate tooltips for nodes', () => {
    const node: GraphNode = {
      id: 'file1.ts',
      label: 'file1.ts',
      type: 'typescript',
      rating: 7.5,
      size: 100,
      violations: [{ type: 'any_usage', severity: 'warning', message: 'any type' }],
      metrics: {
        linesOfCode: 150,
        cyclomaticComplexity: 3,
        numberOfMethods: 5,
        numberOfClasses: 1,
        importCount: 4,
      },
    };
    const tooltip = buildTooltip(node);
    expect(tooltip).toContain('file1.ts');
    expect(tooltip).toContain('7.5');
    expect(tooltip).toContain('150');
  });

  it('should create node colors with background and border', () => {
    const color = makeNodeColor('#22c55e', darkTokens);
    expect(color.background).toBeTruthy();
    expect(color.border).toBeTruthy();
    expect(color.highlight).toBeTruthy();
  });

  it('should generate unique edge IDs', () => {
    const id1 = edgeId('file1.ts', 'file2.ts');
    const id2 = edgeId('file2.ts', 'file1.ts');
    expect(id1).not.toBe(id2);
    expect(id1).toContain('→');
  });

  it('should handle rating boundaries', () => {
    expect(healthLabel(8)).toBe('Healthy');
    expect(healthLabel(7.99)).toBe('Warning');
    expect(healthLabel(6)).toBe('Warning');
    expect(healthLabel(5.99)).toBe('Degraded');
    expect(healthLabel(4)).toBe('Degraded');
    expect(healthLabel(3.99)).toBe('Critical');
  });

  it('should handle nodes with zero metrics', () => {
    const node: GraphNode = {
      id: 'test.ts',
      label: 'test.ts',
      type: 'typescript',
      rating: 6.0,
      size: 100,
      violations: [],
      metrics: {
        linesOfCode: 0,
        cyclomaticComplexity: 0,
        numberOfMethods: 0,
        numberOfClasses: 0,
        importCount: 0,
      },
    };
    const tooltip = buildTooltip(node);
    expect(tooltip).toContain('test.ts');
  });
});
