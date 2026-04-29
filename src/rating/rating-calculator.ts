import { Dependency, Metrics, Violation } from '../types';

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  error: 1.5,
  warning: 0.5,
  info: 0.1
};

export class RatingCalculator {
  calculate(violations: Violation[], metrics: Metrics, dependencies: Dependency[]): number {
    let rating = 10;

    // Deduct for violations
    for (const v of violations) {
      rating -= SEVERITY_DEDUCTIONS[v.severity] ?? 0;
    }

    // Deduct for high cyclomatic complexity
    if (metrics.cyclomaticComplexity > 20) rating -= 2;
    else if (metrics.cyclomaticComplexity > 10) rating -= 1;

    // Deduct for too many imports (tight coupling signal)
    if (metrics.importCount > 30) rating -= 2;
    else if (metrics.importCount > 15) rating -= 0.5;

    // Deduct for excessively large files
    if (metrics.linesOfCode > 500) rating -= 1.5;
    else if (metrics.linesOfCode > 300) rating -= 0.5;

    return Math.max(0, Math.min(10, Math.round(rating * 10) / 10));
  }

  applyCircularDepPenalty(rating: number, circularCount: number): number {
    return Math.max(0, rating - circularCount * 1.0);
  }
}
