/**
 * Tests for src/types/agent.ts — interface structural correctness.
 * Validates that all exported interfaces have the required fields,
 * optional fields, and type shapes expected by consumers.
 */

import {
  Span,
  Fix,
  RatingBreakdownItem,
  AgentResponseEnvelope,
  RemediationStep,
  RemediationPlan,
} from './agent';

// ── Span ──────────────────────────────────────────────────────

describe('Span interface', () => {
  it('can be created with only required fields', () => {
    const span: Span = { line: 1, column: 2, endLine: 3, endColumn: 4 };
    expect(span.line).toBe(1);
    expect(span.column).toBe(2);
    expect(span.endLine).toBe(3);
    expect(span.endColumn).toBe(4);
  });

  it('accepts optional offset field', () => {
    const span: Span = { line: 1, column: 2, endLine: 3, endColumn: 4, offset: 10 };
    expect(span.offset).toBe(10);
  });

  it('accepts optional length field', () => {
    const span: Span = { line: 1, column: 2, endLine: 3, endColumn: 4, length: 80 };
    expect(span.length).toBe(80);
  });

  it('accepts both offset and length together', () => {
    const span: Span = { line: 1, column: 2, endLine: 3, endColumn: 4, offset: 5, length: 80 };
    expect(span.offset).toBe(5);
    expect(span.length).toBe(80);
  });

  it('supports zero-based line/column values', () => {
    const span: Span = { line: 0, column: 0, endLine: 0, endColumn: 0 };
    expect(span.line).toBe(0);
  });

  it('supports large line numbers', () => {
    const span: Span = { line: 99999, column: 0, endLine: 100000, endColumn: 10 };
    expect(span.endLine).toBe(100000);
  });

  it('allows endLine to equal line (single-line span)', () => {
    const span: Span = { line: 5, column: 10, endLine: 5, endColumn: 25 };
    expect(span.endLine).toBe(span.line);
  });
});

// ── Fix ───────────────────────────────────────────────────────

describe('Fix interface', () => {
  it('can be created with only required fields', () => {
    const fix: Fix = { description: 'Add missing semicolon', confidence: 'deterministic' };
    expect(fix.description).toBe('Add missing semicolon');
    expect(fix.confidence).toBe('deterministic');
  });

  it('accepts optional replacement string', () => {
    const fix: Fix = {
      description: 'Replace deprecated API',
      confidence: 'heuristic',
      replacement: 'newApi()',
    };
    expect(fix.replacement).toBe('newApi()');
  });

  it('accepts optional replaceSpan', () => {
    const span: Span = { line: 1, column: 1, endLine: 1, endColumn: 5 };
    const fix: Fix = { description: 'Fix import', replacement: 'import X', replaceSpan: span, confidence: 'manual' };
    expect(fix.replaceSpan).toEqual(span);
  });

  it('rejects invalid confidence values at type level', () => {
    // This is a compile-time check — only the three valid string literals are acceptable.
    const validConfidences: Array<Fix['confidence']> = ['deterministic', 'heuristic', 'manual'];
    expect(validConfidences).toHaveLength(3);
  });

  it('accepts all three confidence levels', () => {
    const d: Fix = { description: 'auto', confidence: 'deterministic' };
    const h: Fix = { description: 'guess', confidence: 'heuristic' };
    const m: Fix = { description: 'ask', confidence: 'manual' };
    expect(d.confidence).toBe('deterministic');
    expect(h.confidence).toBe('heuristic');
    expect(m.confidence).toBe('manual');
  });

  it('can have a full span with replacement', () => {
    const span: Span = { line: 10, column: 0, endLine: 12, endColumn: 0 };
    const fix: Fix = {
      description: 'Wrap in try-catch',
      replacement: 'try { ... }',
      replaceSpan: span,
      confidence: 'heuristic',
    };
    expect(fix.description).toContain('try-catch');
    expect(fix.replaceSpan!.line).toBe(10);
    expect(fix.replacement!.length).toBeGreaterThan(0);
  });
});

// ── RatingBreakdownItem ───────────────────────────────────────

describe('RatingBreakdownItem interface', () => {
  it('can be created with only required fields', () => {
    const item: RatingBreakdownItem = { category: 'naming', deduction: 1.5, detail: 'Bad variable name' };
    expect(item.category).toBe('naming');
    expect(item.deduction).toBe(1.5);
    expect(item.detail).toBe('Bad variable name');
  });

  it('accepts optional ruleId field', () => {
    const item: RatingBreakdownItem = {
      category: 'complexity',
      deduction: 2.0,
      detail: 'Cyclomatic complexity too high',
      ruleId: 'GK-COMP-001',
    };
    expect(item.ruleId).toBe('GK-COMP-001');
  });

  it('supports zero deduction', () => {
    const item: RatingBreakdownItem = { category: 'style', deduction: 0, detail: 'No issues' };
    expect(item.deduction).toBe(0);
  });

  it('supports negative deduction (bonus)', () => {
    const item: RatingBreakdownItem = { category: 'docs', deduction: -0.5, detail: 'Good documentation' };
    expect(item.deduction).toBe(-0.5);
  });

  it('supports fractional deduction values', () => {
    const item: RatingBreakdownItem = { category: 'maintainability', deduction: 0.75, detail: 'Minor concern' };
    expect(item.deduction).toBeCloseTo(0.75);
  });

  it('stores long detail strings', () => {
    const longDetail = 'x'.repeat(500);
    const item: RatingBreakdownItem = { category: 'security', deduction: 3, detail: longDetail };
    expect(item.detail.length).toBe(500);
  });
});

// ── AgentResponseEnvelope ─────────────────────────────────────

describe('AgentResponseEnvelope<T>', () => {
  it('can be created with string data', () => {
    const env: AgentResponseEnvelope<string> = {
      version: '1',
      tool: 'analyze_file',
      generatedAt: 1700000000000,
      data: 'result',
    };
    expect(env.version).toBe('1');
    expect(env.tool).toBe('analyze_file');
    expect(env.generatedAt).toBe(1700000000000);
    expect(env.data).toBe('result');
  });

  it('can be created with object data', () => {
    const env: AgentResponseEnvelope<{ rating: number }> = {
      version: '1',
      tool: 'analyze_file',
      generatedAt: Date.now(),
      data: { rating: 8.5 },
    };
    expect(env.data.rating).toBe(8.5);
  });

  it('can be created with array data', () => {
    const env: AgentResponseEnvelope<number[]> = {
      version: '1',
      tool: 'batch',
      generatedAt: Date.now(),
      data: [1, 2, 3],
    };
    expect(env.data).toHaveLength(3);
  });

  it('can be created with null data', () => {
    const env: AgentResponseEnvelope<null> = {
      version: '1',
      tool: 'empty',
      generatedAt: Date.now(),
      data: null,
    };
    expect(env.data).toBeNull();
  });

  it('enforces version as string literal "1"', () => {
    // The version field is typed as '1' — verify it compiles and works
    const env: AgentResponseEnvelope<unknown> = {
      version: '1',
      tool: 'test',
      generatedAt: 0,
      data: {},
    };
    expect(env.version).toBe('1');
  });

  it('generatedAt can be any epoch timestamp', () => {
    const now = Date.now();
    const env: AgentResponseEnvelope<string> = {
      version: '1', tool: 'x', generatedAt: now, data: 'x',
    };
    expect(env.generatedAt).toBeGreaterThan(0);
    expect(env.generatedAt).toBeLessThanOrEqual(Date.now());
  });
});

// ── RemediationStep ───────────────────────────────────────────

describe('RemediationStep interface', () => {
  it('can be created with only required fields', () => {
    const step: RemediationStep = {
      filePath: 'src/main.ts',
      ruleId: 'GK-001',
      action: 'replace',
      estimatedRatingGain: 1.5,
      dependencyOrder: 1,
    };
    expect(step.filePath).toBe('src/main.ts');
    expect(step.ruleId).toBe('GK-001');
    expect(step.action).toBe('replace');
    expect(step.estimatedRatingGain).toBe(1.5);
    expect(step.dependencyOrder).toBe(1);
  });

  it('accepts optional span field', () => {
    const span: Span = { line: 1, column: 1, endLine: 1, endColumn: 10 };
    const step: RemediationStep = {
      filePath: 'src/a.ts', ruleId: 'GK-002', action: 'insert',
      estimatedRatingGain: 0.5, dependencyOrder: 2, span,
    };
    expect(step.span).toEqual(span);
  });

  it('accepts optional replacement string', () => {
    const step: RemediationStep = {
      filePath: 'src/b.ts', ruleId: 'GK-003', action: 'replace',
      estimatedRatingGain: 2.0, dependencyOrder: 0, replacement: 'new code',
    };
    expect(step.replacement).toBe('new code');
  });

  it('accepts all four action types', () => {
    const actions: Array<RemediationStep['action']> = ['replace', 'insert', 'delete', 'manual'];
    for (const action of actions) {
      const step: RemediationStep = {
        filePath: 'x.ts', ruleId: 'GK-004', action,
        estimatedRatingGain: 0, dependencyOrder: 0,
      };
      expect(step.action).toBe(action);
    }
  });

  it('supports zero rating gain', () => {
    const step: RemediationStep = {
      filePath: 'f.ts', ruleId: 'GK-005', action: 'manual',
      estimatedRatingGain: 0, dependencyOrder: 1,
    };
    expect(step.estimatedRatingGain).toBe(0);
  });

  it('supports zero dependency order (root step)', () => {
    const step: RemediationStep = {
      filePath: 'root.ts', ruleId: 'GK-006', action: 'replace',
      estimatedRatingGain: 3, dependencyOrder: 0,
    };
    expect(step.dependencyOrder).toBe(0);
  });
});

// ── RemediationPlan ───────────────────────────────────────────

describe('RemediationPlan interface', () => {
  const makeStep = (id: string, order: number): RemediationStep => ({
    filePath: `${id}.ts`, ruleId: 'GK-R001', action: 'replace',
    estimatedRatingGain: 1, dependencyOrder: order,
  });

  it('can be created with all required fields', () => {
    const plan: RemediationPlan = {
      rootFile: 'src/main.ts',
      blastRadius: { direct: ['src/a.ts'], transitive: ['src/b.ts'] },
      steps: [makeStep('a', 1)],
      estimatedTotalGain: 2.5,
    };
    expect(plan.rootFile).toBe('src/main.ts');
    expect(plan.blastRadius.direct).toContain('src/a.ts');
    expect(plan.blastRadius.transitive).toContain('src/b.ts');
    expect(plan.steps).toHaveLength(1);
    expect(plan.estimatedTotalGain).toBe(2.5);
  });

  it('supports empty direct and transitive lists', () => {
    const plan: RemediationPlan = {
      rootFile: 'isolated.ts',
      blastRadius: { direct: [], transitive: [] },
      steps: [],
      estimatedTotalGain: 0,
    };
    expect(plan.blastRadius.direct).toHaveLength(0);
    expect(plan.blastRadius.transitive).toHaveLength(0);
  });

  it('supports multiple remediation steps', () => {
    const steps = [makeStep('a', 1), makeStep('b', 2), makeStep('c', 3)];
    const plan: RemediationPlan = {
      rootFile: 'src/core.ts',
      blastRadius: { direct: ['a', 'b'], transitive: ['c'] },
      steps,
      estimatedTotalGain: 5,
    };
    expect(plan.steps).toHaveLength(3);
  });

  it('stores large blast radius lists', () => {
    const direct = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
    const plan: RemediationPlan = {
      rootFile: 'src/core.ts',
      blastRadius: { direct, transitive: [] },
      steps: [],
      estimatedTotalGain: 0,
    };
    expect(plan.blastRadius.direct).toHaveLength(50);
  });

  it('matches expected algebraic property (sum of step gains approximates total)', () => {
    const steps = [makeStep('a', 1), makeStep('b', 2)];
    const totalFromSteps = steps.reduce((s, st) => s + st.estimatedRatingGain, 0);
    const plan: RemediationPlan = {
      rootFile: 'x.ts', blastRadius: { direct: [], transitive: [] },
      steps, estimatedTotalGain: totalFromSteps,
    };
    expect(plan.estimatedTotalGain).toBe(plan.steps.reduce((s, st) => s + st.estimatedRatingGain, 0));
  });
});

// ── Cross-interface compatibility ─────────────────────────────

describe('Cross-interface integration', () => {
  it('Span can be nested inside Fix replaceSpan', () => {
    const span: Span = { line: 1, column: 0, endLine: 1, endColumn: 20 };
    const fix: Fix = {
      description: 'Update import path',
      replacement: './new-path',
      replaceSpan: span,
      confidence: 'deterministic',
    };
    expect(fix.replaceSpan!.offset).toBeUndefined();
    expect(fix.replaceSpan!.line).toBe(1);
  });

  it('Span can be nested inside RemediationStep span', () => {
    const span: Span = { line: 5, column: 2, endLine: 5, endColumn: 14 };
    const step: RemediationStep = {
      filePath: 'src/app.ts', ruleId: 'GK-S001', action: 'delete',
      estimatedRatingGain: 0.3, dependencyOrder: 1, span,
    };
    expect(step.span!.column).toBe(2);
    expect(step.span!.length).toBeUndefined();
  });

  it('RemediationStep[] inside RemediationPlan', () => {
    const plan: RemediationPlan = {
      rootFile: 'src/app.ts',
      blastRadius: { direct: ['dep.ts'], transitive: ['trans.ts'] },
      steps: [
        { filePath: 'dep.ts', ruleId: 'GK-R1', action: 'replace', estimatedRatingGain: 1, dependencyOrder: 0 },
        { filePath: 'app.ts', ruleId: 'GK-R2', action: 'insert', estimatedRatingGain: 0.5, dependencyOrder: 1 },
      ],
      estimatedTotalGain: 1.5,
    };
    expect(plan.steps[0]!.dependencyOrder).toBeLessThan(plan.steps[1]!.dependencyOrder);
  });
});
