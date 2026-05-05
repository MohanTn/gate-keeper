import { RefactoringAdvisor } from './refactoring-advisor';
import { FileAnalysis, Violation, RefactoringHint } from '../types';
import { CycleInfo } from '../graph/dependency-graph';

const createFileAnalysis = (
  path: string,
  violations: Violation[],
  importCount: number = 5
): FileAnalysis => ({
  path,
  language: 'typescript' as const,
  dependencies: [],
  metrics: {
    linesOfCode: 100,
    cyclomaticComplexity: 5,
    numberOfMethods: 3,
    numberOfClasses: 1,
    importCount,
  },
  violations,
  rating: 5,
  analyzedAt: Date.now(),
});

describe('RefactoringAdvisor', () => {
  let advisor: RefactoringAdvisor;

  beforeEach(() => {
    advisor = new RefactoringAdvisor();
  });

  describe('suggest', () => {
    it('returns empty array when no violations or issues', () => {
      const analysis = createFileAnalysis('src/file.ts', []);
      const result = advisor.suggest(analysis, []);
      expect(result).toEqual([]);
    });

    it('generates hint for single violation type', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'god_class', severity: 'error', message: 'God class detected' },
      ]);

      const result = advisor.suggest(analysis, []);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        patternName: 'Extract Service',
        violationType: 'god_class',
        priority: 'high',
        rationale: expect.stringContaining('Single Responsibility'),
        steps: expect.any(Array),
      });
    });

    it('generates hints for multiple violation types', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'console_log', severity: 'warning', message: 'Console.log found' },
        { type: 'missing_key', severity: 'error', message: 'Missing key prop' },
        { type: 'long_method', severity: 'info', message: 'Long method' },
      ]);

      const result = advisor.suggest(analysis, []);

      expect(result).toHaveLength(3);
      expect(result.map(r => r.violationType)).toEqual(
        expect.arrayContaining(['console_log', 'missing_key', 'long_method'])
      );
    });

    it('groups same violation type and calculates combined gain', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'any_type', severity: 'error', message: 'Any type' },
        { type: 'any_type', severity: 'error', message: 'Any type' },
        { type: 'any_type', severity: 'error', message: 'Any type' },
      ]);

      const result = advisor.suggest(analysis, []);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        violationType: 'any_type',
        estimatedRatingGain: 4.5, // 3 * 1.5
      });
    });

    it('respects minCount requirement for violations', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'any_type', severity: 'error', message: 'Any type' },
      ]);

      const result = advisor.suggest(analysis, []);

      // any_type has minCount: 1, so it should be included
      expect(result.some(r => r.violationType === 'any_type')).toBe(true);
    });

    it('skips violations not in REFACTORING_MAP', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'unknown_violation', severity: 'error', message: 'Unknown' },
        { type: 'god_class', severity: 'error', message: 'God class' },
      ]);

      const result = advisor.suggest(analysis, []);

      expect(result).toHaveLength(1);
      expect(result[0].violationType).toBe('god_class');
    });

    it('generates high_import_count hint for imports > 15', () => {
      const analysis = createFileAnalysis('src/file.ts', [], 20);

      const result = advisor.suggest(analysis, []);

      expect(result.some(r => r.violationType === 'high_import_count')).toBe(true);
      const importHint = result.find(r => r.violationType === 'high_import_count');
      expect(importHint).toMatchObject({
        patternName: 'Introduce Module Boundary',
        priority: 'medium',
        estimatedRatingGain: 0.5,
      });
    });

    it('uses higher gain for imports > 30', () => {
      const analysis = createFileAnalysis('src/file.ts', [], 35);

      const result = advisor.suggest(analysis, []);

      const importHint = result.find(r => r.violationType === 'high_import_count');
      expect(importHint?.estimatedRatingGain).toBe(2.0);
    });

    it('does not generate import hint for imports <= 15', () => {
      const analysis = createFileAnalysis('src/file.ts', [], 15);

      const result = advisor.suggest(analysis, []);

      expect(result.some(r => r.violationType === 'high_import_count')).toBe(false);
    });

    it('generates cycle-based hint for circular dependencies', () => {
      const analysis = createFileAnalysis('src/file.ts', []);
      const cycles: CycleInfo[] = [
        { nodes: ['src/file.ts', 'src/other.ts'] },
      ];

      const result = advisor.suggest(analysis, cycles);

      expect(result.some(r => r.violationType === 'circular_dependency')).toBe(true);
      const cycleHint = result.find(r => r.violationType === 'circular_dependency');
      expect(cycleHint).toMatchObject({
        patternName: 'Break Circular Dependency',
        priority: 'high',
        estimatedRatingGain: 1.0,
        rationale: expect.stringContaining('1 circular dependency cycle'),
      });
    });

    it('calculates correct gain for multiple cycles', () => {
      const analysis = createFileAnalysis('src/file.ts', []);
      const cycles: CycleInfo[] = [
        { nodes: ['src/file.ts', 'src/a.ts'] },
        { nodes: ['src/file.ts', 'src/b.ts'] },
        { nodes: ['src/file.ts', 'src/c.ts'] },
      ];

      const result = advisor.suggest(analysis, cycles);

      const cycleHint = result.find(r => r.violationType === 'circular_dependency');
      expect(cycleHint?.estimatedRatingGain).toBe(3.0);
    });

    it('does not generate cycle hint when file not in cycles', () => {
      const analysis = createFileAnalysis('src/file.ts', []);
      const cycles: CycleInfo[] = [
        { nodes: ['src/other1.ts', 'src/other2.ts'] },
      ];

      const result = advisor.suggest(analysis, cycles);

      expect(result.some(r => r.violationType === 'circular_dependency')).toBe(false);
    });

    it('combines violation, import, and cycle hints', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'god_class', severity: 'error', message: 'God class' },
      ], 25);
      const cycles: CycleInfo[] = [
        { nodes: ['src/file.ts', 'src/other.ts'] },
      ];

      const result = advisor.suggest(analysis, cycles);

      expect(result.map(r => r.violationType)).toEqual(
        expect.arrayContaining(['god_class', 'high_import_count', 'circular_dependency'])
      );
    });

    it('sorts hints by estimatedRatingGain descending', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'console_log', severity: 'warning', message: 'Console' }, // gain: 0.5
        { type: 'god_class', severity: 'error', message: 'God class' }, // gain: 1.5
        { type: 'todo_placeholder', severity: 'info', message: 'TODO' }, // gain: 0.1
      ]);

      const result = advisor.suggest(analysis, []);

      expect(result[0].violationType).toBe('god_class');
      expect(result[1].violationType).toBe('console_log');
      expect(result[2].violationType).toBe('todo_placeholder');
    });

    it('sorts by priority when estimatedRatingGain is equal', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'console_log', severity: 'warning', message: 'Console' }, // gain: 0.5, priority: low
        { type: 'low_test_coverage', severity: 'warning', message: 'Low coverage' }, // gain: 0.5, priority: medium
      ]);

      const result = advisor.suggest(analysis, []);

      // Same gain, so priority determines order: high < medium < low
      expect(result[0].violationType).toBe('low_test_coverage');
      expect(result[1].violationType).toBe('console_log');
    });

    it('includes correct steps for each hint type', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'tight_coupling', severity: 'error', message: 'Tight coupling' },
      ]);

      const result = advisor.suggest(analysis, []);

      expect(result[0].steps).toEqual([
        'Create a `XxxOptions` or `XxxConfig` class that groups related parameters.',
        'Or: define an interface for each dependency and inject it via the constructor.',
        'Update the constructor signature to accept the interface/options type.',
        'Update all call sites.',
      ]);
    });

    it('handles both any_type and any_usage violation types', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'any_type', severity: 'error', message: 'Any type' },
        { type: 'any_usage', severity: 'error', message: 'Any usage' },
      ]);

      const result = advisor.suggest(analysis, []);

      expect(result).toHaveLength(2);
      expect(result.map(r => r.patternName)).toEqual(['Add Type Definitions', 'Add Type Definitions']);
    });

    it('handles both no_test_coverage and no_test_file violation types', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'no_test_coverage', severity: 'warning', message: 'No coverage' },
        { type: 'no_test_file', severity: 'warning', message: 'No test file' },
      ]);

      const result = advisor.suggest(analysis, []);

      expect(result).toHaveLength(2);
      expect(result.map(r => r.patternName)).toEqual(['Add Unit Tests', 'Add Unit Tests']);
    });
  });

  describe('gainForViolations', () => {
    it('calculates correct gain for error severity', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'god_class', severity: 'error', message: 'Error' },
      ]);
      const result = advisor.suggest(analysis, []);
      expect(result[0].estimatedRatingGain).toBe(1.5);
    });

    it('calculates correct gain for warning severity', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'console_log', severity: 'warning', message: 'Warning' },
      ]);
      const result = advisor.suggest(analysis, []);
      expect(result[0].estimatedRatingGain).toBe(0.5);
    });

    it('calculates correct gain for info severity', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'magic_number', severity: 'info', message: 'Info' },
      ]);
      const result = advisor.suggest(analysis, []);
      expect(result[0].estimatedRatingGain).toBe(0.1);
    });

    it('calculates mixed severity gains correctly', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'god_class', severity: 'error', message: 'Error' },
        { type: 'missing_key', severity: 'error', message: 'Error' },
        { type: 'console_log', severity: 'warning', message: 'Warning' },
        { type: 'magic_number', severity: 'info', message: 'Info' },
      ]);

      const result = advisor.suggest(analysis, []);

      // Sorted by gain: god_class (1.5), missing_key (1.5), console_log (0.5), magic_number (0.1)
      expect(result[0].estimatedRatingGain).toBe(1.5);
      expect(result[2].estimatedRatingGain).toBe(0.5);
      expect(result[3].estimatedRatingGain).toBe(0.1);
    });

    it('rounds gain to 1 decimal place', () => {
      const analysis = createFileAnalysis('src/file.ts', Array.from({ length: 7 }, () => ({
        type: 'magic_number',
        severity: 'info' as const,
        message: 'Info',
      })));

      const result = advisor.suggest(analysis, []);

      // 7 * 0.1 = 0.7
      expect(result[0].estimatedRatingGain).toBe(0.7);
    });
  });

  describe('specific refactoring rules', () => {
    it('provides correct rule for god_class', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'god_class', severity: 'error', message: 'God class' },
      ]);
      const result = advisor.suggest(analysis, []);
      expect(result[0]).toMatchObject({
        patternName: 'Extract Service',
        priority: 'high',
        rationale: expect.stringContaining('Single Responsibility'),
      });
    });

    it('provides correct rule for hook_overload', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'hook_overload', severity: 'warning', message: 'Hook overload' },
      ]);
      const result = advisor.suggest(analysis, []);
      expect(result[0]).toMatchObject({
        patternName: 'Extract Custom Hook',
        priority: 'high',
        rationale: expect.stringContaining('hard to test'),
      });
    });

    it('provides correct rule for duplicate_hooks', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'duplicate_hooks', severity: 'warning', message: 'Duplicate hooks' },
      ]);
      const result = advisor.suggest(analysis, []);
      expect(result[0]).toMatchObject({
        patternName: 'Consolidate Hook Calls',
        priority: 'medium',
      });
    });

    it('provides correct rule for empty_catch', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'empty_catch', severity: 'error', message: 'Empty catch' },
      ]);
      const result = advisor.suggest(analysis, []);
      expect(result[0]).toMatchObject({
        patternName: 'Handle Exceptions Explicitly',
        priority: 'high',
        rationale: expect.stringContaining('silently swallow'),
      });
    });

    it('provides correct rule for hollow_test_file', () => {
      const analysis = createFileAnalysis('src/file.ts', [
        { type: 'hollow_test_file', severity: 'error', message: 'Hollow test' },
      ]);
      const result = advisor.suggest(analysis, []);
      expect(result[0]).toMatchObject({
        patternName: 'Add Real Test Assertions',
        priority: 'high',
      });
    });
  });
});
