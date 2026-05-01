import { Dependency, Metrics, Violation } from '../types';

export interface RatingBreakdownItem {
  category: string;
  deduction: number;
  detail: string;
}

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  error: 1.5,
  warning: 0.5,
  info: 0.1
};

export class RatingCalculator {
  calculate(violations: Violation[], metrics: Metrics, dependencies: Dependency[]): number {
    return this.calculateWithBreakdown(violations, metrics, dependencies).rating;
  }

  calculateWithBreakdown(
    violations: Violation[],
    metrics: Metrics,
    _dependencies: Dependency[]
  ): { rating: number; breakdown: RatingBreakdownItem[] } {
    const items: RatingBreakdownItem[] = [];
    let rating = 10;

    // ── Violations ──────────────────────────────────────────────────────────
    const errors = violations.filter(v => v.severity === 'error');
    const warnings = violations.filter(v => v.severity === 'warning');
    const infos = violations.filter(v => v.severity === 'info');

    if (errors.length > 0) {
      const d = errors.length * SEVERITY_DEDUCTIONS.error;
      items.push({ category: `Errors (${errors.length})`, deduction: d, detail: `${errors.length} × −1.5 pts` });
      rating -= d;
    }
    if (warnings.length > 0) {
      const d = warnings.length * SEVERITY_DEDUCTIONS.warning;
      items.push({ category: `Warnings (${warnings.length})`, deduction: d, detail: `${warnings.length} × −0.5 pts` });
      rating -= d;
    }
    if (infos.length > 0) {
      const d = infos.length * SEVERITY_DEDUCTIONS.info;
      items.push({ category: `Info hints (${infos.length})`, deduction: Math.round(d * 10) / 10, detail: `${infos.length} × −0.1 pts` });
      rating -= d;
    }

    // ── Maintainability: test coverage (highest priority) ───────────────────
    // Only applied when coverage was actually measured (coveragePercent = undefined
    // means no test file exists — that case is already penalised via violations).
    if (metrics.coveragePercent !== undefined) {
      const pct = metrics.coveragePercent;
      if (pct < 30) {
        const d = 2.5;
        items.push({ category: 'Critical Coverage Gap', deduction: d, detail: `${pct.toFixed(1)}% < 30% — changes are blind` });
        rating -= d;
      } else if (pct < 50) {
        const d = 2.0;
        items.push({ category: 'Low Test Coverage', deduction: d, detail: `${pct.toFixed(1)}% < 50%` });
        rating -= d;
      } else if (pct < 80) {
        const d = 1.0;
        items.push({ category: 'Moderate Test Coverage', deduction: d, detail: `${pct.toFixed(1)}% < 80%` });
        rating -= d;
      }
    }

    // ── Maintainability: class/type size ────────────────────────────────────
    if (metrics.numberOfMethods > 40) {
      items.push({ category: 'Oversized Type', deduction: 1.5, detail: `${metrics.numberOfMethods} methods > 40 — violates Single Responsibility` });
      rating -= 1.5;
    } else if (metrics.numberOfMethods > 20) {
      items.push({ category: 'Large Type', deduction: 0.5, detail: `${metrics.numberOfMethods} methods > 20` });
      rating -= 0.5;
    }

    // Average method length: long methods resist comprehension and change
    if (metrics.numberOfMethods > 0) {
      const avgLines = Math.round(metrics.linesOfCode / metrics.numberOfMethods);
      if (avgLines > 40) {
        items.push({ category: 'Long Methods (avg)', deduction: 1.0, detail: `avg ${avgLines} LOC/method > 40` });
        rating -= 1.0;
      }
    }

    // ── Complexity ──────────────────────────────────────────────────────────
    if (metrics.cyclomaticComplexity > 20) {
      items.push({ category: 'High Complexity', deduction: 2, detail: `Complexity ${metrics.cyclomaticComplexity} > 20` });
      rating -= 2;
    } else if (metrics.cyclomaticComplexity > 10) {
      items.push({ category: 'Moderate Complexity', deduction: 1, detail: `Complexity ${metrics.cyclomaticComplexity} > 10` });
      rating -= 1;
    }

    // ── Coupling ────────────────────────────────────────────────────────────
    if (metrics.importCount > 30) {
      items.push({ category: 'High Coupling', deduction: 2, detail: `${metrics.importCount} imports > 30` });
      rating -= 2;
    } else if (metrics.importCount > 15) {
      items.push({ category: 'Moderate Coupling', deduction: 0.5, detail: `${metrics.importCount} imports > 15` });
      rating -= 0.5;
    }

    // ── File size ───────────────────────────────────────────────────────────
    if (metrics.linesOfCode > 500) {
      items.push({ category: 'Large File', deduction: 1.5, detail: `${metrics.linesOfCode} LOC > 500` });
      rating -= 1.5;
    } else if (metrics.linesOfCode > 300) {
      items.push({ category: 'Medium File', deduction: 0.5, detail: `${metrics.linesOfCode} LOC > 300` });
      rating -= 0.5;
    }

    return {
      rating: Math.max(0, Math.min(10, Math.round(rating * 10) / 10)),
      breakdown: items
    };
  }

  applyCircularDepPenalty(rating: number, circularCount: number): number {
    return Math.max(0, rating - circularCount * 1.0);
  }
}
