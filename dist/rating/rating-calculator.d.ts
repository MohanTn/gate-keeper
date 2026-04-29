import { Dependency, Metrics, Violation } from '../types';
export declare class RatingCalculator {
    calculate(violations: Violation[], metrics: Metrics, dependencies: Dependency[]): number;
    applyCircularDepPenalty(rating: number, circularCount: number): number;
}
//# sourceMappingURL=rating-calculator.d.ts.map