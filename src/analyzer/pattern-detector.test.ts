import { PatternDetector } from './pattern-detector';
import { FileAnalysis, Violation } from '../types';

const createFileAnalysis = (
  path: string,
  violations: Violation[]
): FileAnalysis => ({
  path,
  language: 'typescript' as const,
  dependencies: [],
  metrics: {
    linesOfCode: 100,
    cyclomaticComplexity: 5,
    numberOfMethods: 3,
    numberOfClasses: 1,
    importCount: 5,
  },
  violations,
  rating: 5,
  analyzedAt: Date.now(),
});

describe('PatternDetector', () => {
  let detector: PatternDetector;

  beforeEach(() => {
    detector = new PatternDetector();
  });

  describe('detect', () => {
    it('returns empty array when input is empty', () => {
      const result = detector.detect([]);
      expect(result).toEqual([]);
    });

    it('detects single violation type in single file', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/components/Button.tsx', [
          { type: 'console_log', severity: 'warning', message: 'Console.log found', line: 10 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        violationType: 'console_log',
        severity: 'warning',
        fileCount: 1,
        totalOccurrences: 1,
        estimatedRatingGain: 0.5,
        moduleSuggestion: expect.stringContaining('eslint-plugin-no-console'),
      });
    });

    it('aggregates same violation type across multiple files', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/components/Button.tsx', [
          { type: 'any_type', severity: 'error', message: 'Any type used', line: 5 },
        ]),
        createFileAnalysis('src/utils/helper.ts', [
          { type: 'any_type', severity: 'error', message: 'Any type used', line: 12 },
          { type: 'any_type', severity: 'error', message: 'Any type used', line: 25 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        violationType: 'any_type',
        severity: 'error',
        fileCount: 2,
        totalOccurrences: 3,
        estimatedRatingGain: 4.5, // 3 * 1.5
      });
    });

    it('groups different violation types separately', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/components/App.tsx', [
          { type: 'missing_key', severity: 'error', message: 'Missing key prop', line: 20 },
          { type: 'inline_handler', severity: 'warning', message: 'Inline handler', line: 25 },
          { type: 'console_log', severity: 'info', message: 'Console.log', line: 30 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result).toHaveLength(3);
      expect(result.map(r => r.violationType)).toEqual(
        expect.arrayContaining(['missing_key', 'inline_handler', 'console_log'])
      );
    });

    it('uses highest severity when same type has different severities', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file1.ts', [
          { type: 'magic_number', severity: 'info', message: 'Magic number', line: 5 },
        ]),
        createFileAnalysis('src/file2.ts', [
          { type: 'magic_number', severity: 'warning', message: 'Magic number', line: 10 },
        ]),
        createFileAnalysis('src/file3.ts', [
          { type: 'magic_number', severity: 'error', message: 'Magic number', line: 15 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result[0].severity).toBe('error');
    });

    it('calculates estimatedRatingGain correctly for each severity', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file.ts', [
          { type: 'god_class', severity: 'error', message: 'God class', line: 1 },
          { type: 'hook_overload', severity: 'warning', message: 'Hook overload', line: 2 },
          { type: 'todo_placeholder', severity: 'info', message: 'TODO found', line: 3 },
        ]),
      ];

      const result = detector.detect(analyses);

      const errorReport = result.find(r => r.violationType === 'god_class');
      const warningReport = result.find(r => r.violationType === 'hook_overload');
      const infoReport = result.find(r => r.violationType === 'todo_placeholder');

      expect(errorReport?.estimatedRatingGain).toBe(1.5);
      expect(warningReport?.estimatedRatingGain).toBe(0.5);
      expect(infoReport?.estimatedRatingGain).toBe(0.1);
    });

    it('sorts by estimatedRatingGain descending, then fileCount descending', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file1.ts', [
          { type: 'low_test_coverage', severity: 'info', message: 'Low coverage', line: 1 },
          { type: 'low_test_coverage', severity: 'info', message: 'Low coverage', line: 2 },
          { type: 'low_test_coverage', severity: 'info', message: 'Low coverage', line: 3 },
        ]),
        createFileAnalysis('src/file2.ts', [
          { type: 'low_test_coverage', severity: 'info', message: 'Low coverage', line: 1 },
        ]),
        createFileAnalysis('src/file3.ts', [
          { type: 'any_type', severity: 'error', message: 'Any type', line: 1 },
        ]),
      ];

      const result = detector.detect(analyses);

      // low_test_coverage: 4 * 0.1 = 0.4, any_type: 1 * 1.5 = 1.5
      expect(result[0].violationType).toBe('any_type');
      expect(result[1].violationType).toBe('low_test_coverage');
    });

    it('limits affectedFiles to first 10 files', () => {
      const analyses: FileAnalysis[] = Array.from({ length: 15 }, (_, i) =>
        createFileAnalysis(`src/file${i}.ts`, [
          { type: 'console_log', severity: 'warning', message: 'Console.log', line: 1 },
        ])
      );

      const result = detector.detect(analyses);

      expect(result[0].fileCount).toBe(15);
      expect(result[0].affectedFiles).toHaveLength(10);
    });

    it('uses default moduleSuggestion for unknown violation types', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file.ts', [
          { type: 'unknown_violation', severity: 'warning', message: 'Unknown', line: 1 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result[0].moduleSuggestion).toBe(
        'Fix all unknown_violation occurrences codebase-wide.'
      );
    });

    it('uses predefined moduleSuggestion for known violation types', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file.ts', [
          { type: 'tight_coupling', severity: 'error', message: 'Tight coupling', line: 1 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result[0].moduleSuggestion).toContain('constructor DI');
    });

    it('handles files with no violations', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/clean-file.ts', []),
        createFileAnalysis('src/file-with-issues.ts', [
          { type: 'empty_catch', severity: 'warning', message: 'Empty catch', line: 10 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result).toHaveLength(1);
      expect(result[0].violationType).toBe('empty_catch');
      expect(result[0].fileCount).toBe(1);
    });

    it('handles multiple occurrences in same file correctly', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/complex-file.ts', [
          { type: 'long_method', severity: 'warning', message: 'Long method', line: 10 },
          { type: 'long_method', severity: 'warning', message: 'Long method', line: 60 },
          { type: 'long_method', severity: 'warning', message: 'Long method', line: 120 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result[0]).toMatchObject({
        violationType: 'long_method',
        fileCount: 1,
        totalOccurrences: 3,
        estimatedRatingGain: 1.5, // 3 * 0.5
      });
    });

    it('handles all known violation types from MODULE_SUGGESTIONS', () => {
      const knownTypes = [
        'god_class', 'hook_overload', 'duplicate_hooks', 'tight_coupling',
        'any_type', 'any_usage', 'console_log', 'missing_key', 'inline_handler',
        'long_method', 'empty_catch', 'todo_placeholder', 'unimplemented_stub',
        'tech_debt_marker', 'magic_number', 'no_test_coverage', 'no_test_file',
        'low_test_coverage', 'moderate_test_coverage', 'uncovered_lines',
        'hollow_test_file', 'analysis_error', 'high_import_count'
      ];

      const analyses: FileAnalysis[] = knownTypes.map(type =>
        createFileAnalysis(`src/${type}.ts`, [
          { type, severity: 'warning', message: 'Test', line: 1 },
        ])
      );

      const result = detector.detect(analyses);

      expect(result).toHaveLength(knownTypes.length);
      result.forEach(report => {
        expect(report.moduleSuggestion).toBeDefined();
        expect(report.moduleSuggestion.length).toBeGreaterThan(0);
      });
    });
  });

  describe('severity escalation', () => {
    it('escalates warning to error when error is encountered', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file1.ts', [
          { type: 'missing_key', severity: 'warning', message: 'Warning', line: 1 },
        ]),
        createFileAnalysis('src/file2.ts', [
          { type: 'missing_key', severity: 'error', message: 'Error', line: 1 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result[0].severity).toBe('error');
    });

    it('does not downgrade error to warning', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file1.ts', [
          { type: 'missing_key', severity: 'error', message: 'Error', line: 1 },
        ]),
        createFileAnalysis('src/file2.ts', [
          { type: 'missing_key', severity: 'warning', message: 'Warning', line: 1 },
        ]),
      ];

      const result = detector.detect(analyses);

      expect(result[0].severity).toBe('error');
    });
  });

  describe('rating gain calculations', () => {
    it('rounds rating gain to 1 decimal place', () => {
      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file.ts', Array.from({ length: 7 }, () => ({
          type: 'info_violation',
          severity: 'info' as const,
          message: 'Info',
          line: 1,
        }))),
      ];

      const result = detector.detect(analyses);

      // 7 * 0.1 = 0.7, should be exactly 0.7
      expect(result[0].estimatedRatingGain).toBe(0.7);
    });

    it('calculates rating gain for large occurrence counts', () => {
      const violations = Array.from({ length: 100 }, () => ({
        type: 'console_log',
        severity: 'warning' as const,
        message: 'Console',
        line: 1,
      }));

      const analyses: FileAnalysis[] = [
        createFileAnalysis('src/file.ts', violations),
      ];

      const result = detector.detect(analyses);

      // 100 * 0.5 = 50
      expect(result[0].estimatedRatingGain).toBe(50);
    });
  });
});
