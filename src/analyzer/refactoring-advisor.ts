import * as path from 'path';
import { FileAnalysis, Violation, RefactoringHint } from '../types';
import { CycleInfo } from '../graph/dependency-graph';

interface RefactoringRule {
  patternName: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
  steps: string[];
  minCount?: number;
}

const REFACTORING_MAP: Record<string, RefactoringRule> = {
  god_class: {
    patternName: 'Extract Service',
    priority: 'high',
    rationale: 'A class with >20 methods violates Single Responsibility and resists change.',
    steps: [
      'List all methods and group them by the "noun" they operate on.',
      'Create one new class per group (e.g. UserRepository, UserValidator).',
      'Move the methods, adjusting access modifiers.',
      'Replace original class references with constructor-injected dependencies.',
      'Delete the original god class once all callers are updated.',
    ],
  },
  hook_overload: {
    patternName: 'Extract Custom Hook',
    priority: 'high',
    rationale: 'Components with >7 hooks are hard to test and reuse.',
    steps: [
      'Identify groups of 2–3 hooks that share a common concern (e.g. form state, auth state).',
      'Create a `useXxx` file in a `/hooks` directory for each group.',
      'Move the hook calls and their derived state into the custom hook.',
      'Return only the values the component needs from the custom hook.',
      'Replace the inline hook calls in the component with a single `useXxx()` call.',
    ],
  },
  duplicate_hooks: {
    patternName: 'Consolidate Hook Calls',
    priority: 'medium',
    rationale: 'Calling the same hook twice creates redundant subscriptions and subtle bugs.',
    steps: [
      'Find all calls to the duplicated hook.',
      'Merge them into a single call at the top of the component.',
      'Destructure all needed values from the single call.',
    ],
  },
  tight_coupling: {
    patternName: 'Apply Dependency Injection',
    priority: 'high',
    rationale: 'Constructors with >5 parameters signal tightly coupled dependencies.',
    steps: [
      'Create a `XxxOptions` or `XxxConfig` class that groups related parameters.',
      'Or: define an interface for each dependency and inject it via the constructor.',
      'Update the constructor signature to accept the interface/options type.',
      'Update all call sites.',
    ],
  },
  any_type: {
    patternName: 'Add Type Definitions',
    priority: 'medium',
    rationale: '`any` bypasses the type checker and hides bugs.',
    steps: [
      'For each `any`, examine the actual runtime shape of the value.',
      'Create a named interface or type alias in a co-located `types.ts`.',
      'Replace `any` with the specific type or `unknown` + a type guard.',
    ],
    minCount: 1,
  },
  any_usage: {
    patternName: 'Add Type Definitions',
    priority: 'medium',
    rationale: '`any` bypasses the type checker and hides bugs.',
    steps: [
      'For each `any`, examine the actual runtime shape of the value.',
      'Create a named interface or type alias in a co-located `types.ts`.',
      'Replace `any` with the specific type or `unknown` + a type guard.',
    ],
    minCount: 1,
  },
  console_log: {
    patternName: 'Replace Console Statements',
    priority: 'low',
    rationale: 'console.log leaks internals and clutters production logs.',
    steps: [
      'Delete debug console.log calls.',
      'Replace intentional logging with a structured logger (e.g. pino, winston).',
    ],
  },
  missing_key: {
    patternName: 'Add Stable List Keys',
    priority: 'high',
    rationale: 'Missing key props cause React to re-mount list items unnecessarily.',
    steps: [
      'Add `key={item.id}` (or another stable unique field) to the outermost JSX element inside every `.map()` callback.',
      'Never use array index as key unless the list is static and never reordered.',
    ],
  },
  inline_handler: {
    patternName: 'Extract Event Handlers',
    priority: 'low',
    rationale: 'Inline arrow functions in JSX create new references on every render.',
    steps: [
      'Move the inline function body to a named `const handleXxx = useCallback(...)` above the JSX return.',
      'Pass the named function as the event handler prop.',
    ],
  },
  long_method: {
    patternName: 'Decompose Method',
    priority: 'medium',
    rationale: 'Methods >50 lines are hard to test and reason about.',
    steps: [
      'Find the natural "paragraphs" in the method (groups of lines with a shared purpose).',
      'Extract each paragraph into a private helper method with a descriptive name.',
      'Replace the paragraph in the original method with a single call to the helper.',
    ],
  },
  empty_catch: {
    patternName: 'Handle Exceptions Explicitly',
    priority: 'high',
    rationale: 'Empty catch blocks silently swallow errors, making failures invisible.',
    steps: [
      'At minimum, log the error: `console.error(err)` or use your structured logger.',
      'If the error is expected and safe to ignore, add a comment explaining why.',
      'If the error is unrecoverable, rethrow it.',
    ],
  },
  todo_placeholder: {
    patternName: 'Resolve TODO Markers',
    priority: 'medium',
    rationale: 'TODO/FIXME markers indicate incomplete work that should not reach production.',
    steps: [
      'Implement the missing functionality, or create a tracked issue.',
      'Remove the marker once addressed.',
    ],
  },
  unimplemented_stub: {
    patternName: 'Implement Required Functionality',
    priority: 'high',
    rationale: 'Stubs that throw at runtime will crash in production.',
    steps: [
      'Implement the actual logic.',
      'If not yet possible, at least return a safe default and log a warning.',
    ],
  },
  tech_debt_marker: {
    patternName: 'Track and Schedule Technical Debt',
    priority: 'low',
    rationale: 'HACK/WORKAROUND markers accumulate and degrade maintainability.',
    steps: [
      'Create a ticket in your issue tracker referencing the file and line.',
      'Add a comment with the ticket number next to the marker.',
      'Schedule the cleanup in the next sprint.',
    ],
  },
  magic_number: {
    patternName: 'Extract Named Constants',
    priority: 'low',
    rationale: 'Magic numbers make code opaque and brittle to change.',
    steps: [
      'Move each magic number to a `const` at the top of the file or in a `constants.ts`.',
      'Give it a name that explains what it means, not just its value.',
    ],
  },
  no_test_coverage: {
    patternName: 'Add Unit Tests',
    priority: 'high',
    rationale: 'No test coverage means changes are made blind.',
    steps: [
      'Create a `*.test.ts` file alongside the source file.',
      'Write at minimum one test for each exported function.',
      'Run with `--coverage` to verify coverage registers.',
    ],
  },
  no_test_file: {
    patternName: 'Add Unit Tests',
    priority: 'high',
    rationale: 'No test coverage means changes are made blind.',
    steps: [
      'Create a `*.test.ts` file alongside the source file.',
      'Write at minimum one test for each exported function.',
      'Run with `--coverage` to verify coverage registers.',
    ],
  },
  low_test_coverage: {
    patternName: 'Increase Test Coverage to 80%',
    priority: 'medium',
    rationale: 'Coverage below 50% leaves most logic paths untested.',
    steps: [
      'Run `npx jest --coverage` and open the HTML report.',
      'Focus on uncovered branches (conditionals, error paths).',
      'Add tests until coverage exceeds 80%.',
    ],
  },
  hollow_test_file: {
    patternName: 'Add Real Test Assertions',
    priority: 'high',
    rationale: 'Test files with empty suites or no assertions provide no safety net.',
    steps: [
      'Review the test file for empty `describe` or `it` blocks.',
      'Add at least one real assertion per exported function.',
      'Run tests and verify they fail when code breaks.',
    ],
  },
};

const HIGH_IMPORT_HINT: RefactoringRule = {
  patternName: 'Introduce Module Boundary',
  priority: 'medium',
  rationale: '>15 imports signal a file doing too much; >30 is a coupling crisis.',
  steps: [
    'Identify clusters of imports that relate to the same concern.',
    'Create a barrel/index.ts for each cluster.',
    'Or: split the file into feature-focused modules.',
    'Aim for ≤15 imports per file.',
  ],
};

export class RefactoringAdvisor {
  suggest(analysis: FileAnalysis, cycles: CycleInfo[]): RefactoringHint[] {
    const hints: RefactoringHint[] = [];

    // ── 1. Violation-based hints ───────────────────────────
    const violationsByType = new Map<string, Violation[]>();
    for (const v of analysis.violations) {
      const group = violationsByType.get(v.type) ?? [];
      group.push(v);
      violationsByType.set(v.type, group);
    }

    for (const [type, violations] of violationsByType) {
      const rule = REFACTORING_MAP[type];
      if (!rule) continue;
      if (rule.minCount !== undefined && violations.length < rule.minCount) continue;

      hints.push({
        patternName: rule.patternName,
        violationType: type,
        rationale: rule.rationale,
        steps: rule.steps,
        estimatedRatingGain: this.gainForViolations(violations),
        priority: rule.priority,
      });
    }

    // ── 2. Metrics-based hints ─────────────────────────────
    if (analysis.metrics.importCount > 15) {
      const rule = HIGH_IMPORT_HINT;
      const gain = analysis.metrics.importCount > 30 ? 2.0 : 0.5;
      hints.push({
        patternName: rule.patternName,
        violationType: 'high_import_count',
        rationale: rule.rationale,
        steps: rule.steps,
        estimatedRatingGain: gain,
        priority: rule.priority,
      });
    }

    // ── 3. Cycle-based hints ───────────────────────────────
    const fileCycles = cycles.filter(c => c.nodes.includes(analysis.path));
    if (fileCycles.length > 0) {
      hints.push({
        patternName: 'Break Circular Dependency',
        violationType: 'circular_dependency',
        rationale: `This file participates in ${fileCycles.length} circular dependency cycle(s), costing −${fileCycles.length}.0 rating.`,
        steps: [
          'Identify which import creates the cycle (usually an upward import).',
          'Extract shared types into a new `types.ts` or `interfaces.ts` that neither module imports.',
          'Apply Dependency Inversion: depend on an abstraction (interface), not a concrete implementation.',
          'Or: merge the two tightly coupled files if they are truly inseparable.',
        ],
        estimatedRatingGain: fileCycles.length * 1.0,
        priority: 'high',
      });
    }

    // ── 4. Sort by estimated gain descending ───────────────
    hints.sort((a, b) => {
      if (b.estimatedRatingGain !== a.estimatedRatingGain) {
        return b.estimatedRatingGain - a.estimatedRatingGain;
      }
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return hints;
  }

  private gainForViolations(violations: Violation[]): number {
    const DEDUCTIONS: Record<string, number> = { error: 1.5, warning: 0.5, info: 0.1 };
    const total = violations.reduce((sum, v) => sum + (DEDUCTIONS[v.severity] ?? 0), 0);
    return Math.round(total * 10) / 10;
  }
}
