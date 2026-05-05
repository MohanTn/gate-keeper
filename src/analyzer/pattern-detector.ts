import { FileAnalysis, PatternReport } from '../types';

const MODULE_SUGGESTIONS: Record<string, string> = {
  god_class:         'Audit all large classes; schedule a refactoring sprint to apply Extract Class.',
  hook_overload:     'Create a `/hooks` directory; extract custom hooks project-wide.',
  duplicate_hooks:   'Search-and-merge duplicate hook calls across all components.',
  tight_coupling:    'Introduce constructor DI or a parameter object pattern across all services.',
  any_type:          'Enable `noImplicitAny` in tsconfig.json to catch new occurrences at compile time.',
  any_usage:         'Enable `noImplicitAny` in tsconfig.json to catch new occurrences at compile time.',
  console_log:       'Install eslint-plugin-no-console and enable as error in CI.',
  missing_key:       'Add eslint-plugin-react `react/jsx-key` rule as error.',
  inline_handler:    'Add eslint rule `react/jsx-no-bind` to catch new occurrences.',
  long_method:       'Adopt a team rule: methods >40 lines require a PR comment.',
  empty_catch:       'Add a linting rule for empty catch blocks (e.g. `no-empty` in ESLint).',
  todo_placeholder:  'Set up a pre-commit hook that blocks TODO/FIXME markers without a ticket number.',
  unimplemented_stub:'Add a test that calls every exported function — stubs will throw and fail CI.',
  tech_debt_marker:  'Create a "tech-debt" label in your issue tracker; link each HACK comment.',
  magic_number:      'Create a shared `constants.ts` module; add a lint rule against literal numbers.',
  no_test_coverage:  'Enforce a minimum Jest coverage threshold in jest.config.js.',
  no_test_file:      'Enforce a minimum Jest coverage threshold in jest.config.js.',
  low_test_coverage: 'Set `coverageThreshold` to 50 in jest.config.js; increase to 80 over time.',
  moderate_test_coverage: 'Add branch coverage reporting; target 80% for all core modules.',
  uncovered_lines:   'Focus test additions on the specific uncovered lines listed in the lcov report.',
  hollow_test_file:  'Audit all test files for empty describe/it blocks; add real assertions.',
  analysis_error:    'Investigate analysis failures; they may indicate syntax errors or encoding issues.',
  high_import_count: 'Introduce barrel files or feature modules to reduce per-file import counts.',
};

export class PatternDetector {
  detect(analyses: FileAnalysis[]): PatternReport[] {
    if (analyses.length === 0) return [];

    // ── Group violations by type across all files ──────────
    interface PatternAccumulator {
      severity: 'error' | 'warning' | 'info';
      files: Set<string>;
      totalOccurrences: number;
    }

    const patterns = new Map<string, PatternAccumulator>();

    for (const analysis of analyses) {
      for (const violation of analysis.violations) {
        const acc = patterns.get(violation.type) ?? {
          severity: violation.severity,
          files: new Set<string>(),
          totalOccurrences: 0,
        };
        acc.files.add(analysis.path);
        acc.totalOccurrences++;
        // Severity: take the highest severity seen for this type
        if (violation.severity === 'error') acc.severity = 'error';
        else if (violation.severity === 'warning' && acc.severity !== 'error') acc.severity = 'warning';
        patterns.set(violation.type, acc);
      }
    }

    // ── Compute estimatedRatingGain ──────────────────────────
    const DEDUCTIONS: Record<string, number> = { error: 1.5, warning: 0.5, info: 0.1 };

    const reports: PatternReport[] = [];

    for (const [violationType, acc] of patterns) {
      const deductionPerInstance = DEDUCTIONS[acc.severity] ?? 0.1;
      const estimatedRatingGain = Math.round(acc.totalOccurrences * deductionPerInstance * 10) / 10;

      reports.push({
        violationType,
        severity: acc.severity,
        fileCount: acc.files.size,
        totalOccurrences: acc.totalOccurrences,
        affectedFiles: [...acc.files].slice(0, 10),
        estimatedRatingGain,
        moduleSuggestion: MODULE_SUGGESTIONS[violationType] ?? `Fix all ${violationType} occurrences codebase-wide.`,
      });
    }

    // ── Sort: by estimatedRatingGain desc, then fileCount desc ──
    reports.sort((a, b) =>
      b.estimatedRatingGain - a.estimatedRatingGain ||
      b.fileCount - a.fileCount
    );

    return reports;
  }
}
