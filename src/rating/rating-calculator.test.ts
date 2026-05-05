import { RatingCalculator, RatingBreakdownItem } from './rating-calculator';
import { Violation, Metrics, Dependency } from '../types';

describe('RatingCalculator', () => {
  let calculator: RatingCalculator;

  beforeEach(() => {
    calculator = new RatingCalculator();
  });

  const defaultMetrics: Metrics = {
    linesOfCode: 100,
    cyclomaticComplexity: 5,
    numberOfMethods: 10,
    numberOfClasses: 2,
    importCount: 5,
  };

  const defaultViolations: Violation[] = [];
  const defaultDependencies: Dependency[] = [];

  describe('calculate', () => {
    it('should return 10 for perfect code', () => {
      const rating = calculator.calculate(defaultViolations, defaultMetrics, defaultDependencies);
      expect(rating).toBe(10);
    });

    it('should clamp rating between 0 and 10', () => {
      const severeViolations: Violation[] = Array(20).fill({
        type: 'error',
        severity: 'error',
        message: 'Critical error',
      });

      const badMetrics: Metrics = {
        linesOfCode: 1000,
        cyclomaticComplexity: 50,
        numberOfMethods: 100,
        numberOfClasses: 20,
        importCount: 50,
      };

      const rating = calculator.calculate(severeViolations, badMetrics, defaultDependencies);
      expect(rating).toBeGreaterThanOrEqual(0);
      expect(rating).toBeLessThanOrEqual(10);
    });
  });

  describe('calculateWithBreakdown', () => {
    it('should provide breakdown for violations', () => {
      const violations: Violation[] = [
        { type: 'error', severity: 'error', message: 'Error 1' },
        { type: 'error', severity: 'error', message: 'Error 2' },
        { type: 'warning', severity: 'warning', message: 'Warning 1' },
        { type: 'info', severity: 'info', message: 'Info 1' },
      ];

      const result = calculator.calculateWithBreakdown(violations, defaultMetrics, defaultDependencies);

      expect(result.breakdown.length).toBeGreaterThan(0);
      expect(result.rating).toBeLessThan(10);

      const errorDeduction = result.breakdown.find(b => b.category.includes('Errors'));
      expect(errorDeduction).toBeDefined();
      expect(errorDeduction?.detail).toContain('2 × −1.5 pts');
    });

    describe('error deductions', () => {
      it('should deduct 1.5 points per error', () => {
        const violations: Violation[] = [
          { type: 'error', severity: 'error', message: 'Error 1' },
          { type: 'error', severity: 'error', message: 'Error 2' },
          { type: 'error', severity: 'error', message: 'Error 3' },
        ];

        const result = calculator.calculateWithBreakdown(violations, defaultMetrics, defaultDependencies);

        expect(result.rating).toBeCloseTo(5.5, 1); // 10 - (3 * 1.5)
      });
    });

    describe('warning deductions', () => {
      it('should deduct 0.5 points per warning', () => {
        const violations: Violation[] = [
          { type: 'warning', severity: 'warning', message: 'Warning 1' },
          { type: 'warning', severity: 'warning', message: 'Warning 2' },
          { type: 'warning', severity: 'warning', message: 'Warning 3' },
          { type: 'warning', severity: 'warning', message: 'Warning 4' },
        ];

        const result = calculator.calculateWithBreakdown(violations, defaultMetrics, defaultDependencies);

        expect(result.rating).toBeCloseTo(8, 1); // 10 - (4 * 0.5)
      });
    });

    describe('info deductions', () => {
      it('should deduct 0.1 points per info', () => {
        const violations: Violation[] = [
          { type: 'info', severity: 'info', message: 'Info 1' },
          { type: 'info', severity: 'info', message: 'Info 2' },
          { type: 'info', severity: 'info', message: 'Info 3' },
          { type: 'info', severity: 'info', message: 'Info 4' },
          { type: 'info', severity: 'info', message: 'Info 5' },
        ];

        const result = calculator.calculateWithBreakdown(violations, defaultMetrics, defaultDependencies);

        expect(result.rating).toBeCloseTo(9.5, 1); // 10 - (5 * 0.1)
      });
    });

    describe('coverage penalties', () => {
      it('should penalize critical coverage (<30%)', () => {
        const metrics: Metrics = { ...defaultMetrics, coveragePercent: 25 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const coverageDeduction = result.breakdown.find(b => b.category.includes('Coverage'));
        expect(coverageDeduction).toBeDefined();
        expect(coverageDeduction?.deduction).toBe(2.5);
        expect(result.rating).toBeCloseTo(7.5, 1);
      });

      it('should penalize low coverage (30-50%)', () => {
        const metrics: Metrics = { ...defaultMetrics, coveragePercent: 40 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const coverageDeduction = result.breakdown.find(b => b.category.includes('Coverage'));
        expect(coverageDeduction).toBeDefined();
        expect(coverageDeduction?.deduction).toBe(2.0);
        expect(result.rating).toBeCloseTo(8, 1);
      });

      it('should penalize moderate coverage (50-80%)', () => {
        const metrics: Metrics = { ...defaultMetrics, coveragePercent: 65 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const coverageDeduction = result.breakdown.find(b => b.category.includes('Coverage'));
        expect(coverageDeduction).toBeDefined();
        expect(coverageDeduction?.deduction).toBe(1.0);
        expect(result.rating).toBeCloseTo(9, 1);
      });

      it('should not penalize high coverage (>=80%)', () => {
        const metrics: Metrics = { ...defaultMetrics, coveragePercent: 90 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const coverageDeduction = result.breakdown.find(b => b.category.includes('Coverage'));
        expect(coverageDeduction).toBeUndefined();
        expect(result.rating).toBe(10);
      });

      it('should not apply coverage penalty when coveragePercent is undefined', () => {
        const metrics: Metrics = { ...defaultMetrics, coveragePercent: undefined };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const coverageDeduction = result.breakdown.find(b => b.category.includes('Coverage'));
        expect(coverageDeduction).toBeUndefined();
      });
    });

    describe('class/type size penalties', () => {
      it('should penalize oversized types (>40 methods)', () => {
        const metrics: Metrics = { ...defaultMetrics, numberOfMethods: 50 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const sizeDeduction = result.breakdown.find(b => b.category.includes('Oversized'));
        expect(sizeDeduction).toBeDefined();
        expect(sizeDeduction?.deduction).toBe(1.5);
      });

      it('should penalize large types (20-40 methods)', () => {
        const metrics: Metrics = { ...defaultMetrics, numberOfMethods: 30 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const sizeDeduction = result.breakdown.find(b => b.category.includes('Large'));
        expect(sizeDeduction).toBeDefined();
        expect(sizeDeduction?.deduction).toBe(0.5);
      });

      it('should not penalize reasonable method counts', () => {
        const metrics: Metrics = { ...defaultMetrics, numberOfMethods: 15 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const sizeDeduction = result.breakdown.find(b => b.category.includes('versized') || b.category.includes('arge'));
        expect(sizeDeduction).toBeUndefined();
      });

      it('should penalize long average method length', () => {
        const metrics: Metrics = {
          linesOfCode: 1000,
          numberOfMethods: 10,
          cyclomaticComplexity: 5,
          numberOfClasses: 2,
          importCount: 5,
        };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const methodLengthDeduction = result.breakdown.find(b => b.category.includes('Long Methods'));
        expect(methodLengthDeduction).toBeDefined();
        expect(methodLengthDeduction?.deduction).toBe(1.0);
      });
    });

    describe('complexity penalties', () => {
      it('should penalize high complexity (>20)', () => {
        const metrics: Metrics = { ...defaultMetrics, cyclomaticComplexity: 25 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const complexityDeduction = result.breakdown.find(b => b.category.includes('High Complexity'));
        expect(complexityDeduction).toBeDefined();
        expect(complexityDeduction?.deduction).toBe(2);
      });

      it('should penalize moderate complexity (10-20)', () => {
        const metrics: Metrics = { ...defaultMetrics, cyclomaticComplexity: 15 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const complexityDeduction = result.breakdown.find(b => b.category.includes('Moderate Complexity'));
        expect(complexityDeduction).toBeDefined();
        expect(complexityDeduction?.deduction).toBe(1);
      });

      it('should not penalize low complexity', () => {
        const metrics: Metrics = { ...defaultMetrics, cyclomaticComplexity: 5 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const complexityDeduction = result.breakdown.find(b => b.category.includes('Complexity'));
        expect(complexityDeduction).toBeUndefined();
      });
    });

    describe('coupling penalties', () => {
      it('should penalize high coupling (>30 imports)', () => {
        const metrics: Metrics = { ...defaultMetrics, importCount: 40 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const couplingDeduction = result.breakdown.find(b => b.category.includes('High Coupling'));
        expect(couplingDeduction).toBeDefined();
        expect(couplingDeduction?.deduction).toBe(2);
      });

      it('should penalize moderate coupling (15-30 imports)', () => {
        const metrics: Metrics = { ...defaultMetrics, importCount: 20 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const couplingDeduction = result.breakdown.find(b => b.category.includes('Moderate Coupling'));
        expect(couplingDeduction).toBeDefined();
        expect(couplingDeduction?.deduction).toBe(0.5);
      });

      it('should not penalize low coupling', () => {
        const metrics: Metrics = { ...defaultMetrics, importCount: 10 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const couplingDeduction = result.breakdown.find(b => b.category.includes('Coupling'));
        expect(couplingDeduction).toBeUndefined();
      });
    });

    describe('file size penalties', () => {
      it('should penalize large files (>500 LOC)', () => {
        const metrics: Metrics = { ...defaultMetrics, linesOfCode: 600 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const sizeDeduction = result.breakdown.find(b => b.category.includes('Large File'));
        expect(sizeDeduction).toBeDefined();
        expect(sizeDeduction?.deduction).toBe(1.5);
      });

      it('should penalize medium files (300-500 LOC)', () => {
        const metrics: Metrics = { ...defaultMetrics, linesOfCode: 400 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const sizeDeduction = result.breakdown.find(b => b.category.includes('Medium File'));
        expect(sizeDeduction).toBeDefined();
        expect(sizeDeduction?.deduction).toBe(0.5);
      });

      it('should not penalize small files', () => {
        const metrics: Metrics = { ...defaultMetrics, linesOfCode: 200 };

        const result = calculator.calculateWithBreakdown(defaultViolations, metrics, defaultDependencies);

        const sizeDeduction = result.breakdown.find(b => b.category.includes('File'));
        expect(sizeDeduction).toBeUndefined();
      });
    });

    describe('combined penalties', () => {
      it('should accumulate multiple penalties', () => {
        const violations: Violation[] = [
          { type: 'error', severity: 'error', message: 'Error' },
        ];
        const metrics: Metrics = {
          linesOfCode: 600,
          cyclomaticComplexity: 25,
          numberOfMethods: 50,
          numberOfClasses: 10,
          importCount: 40,
          coveragePercent: 25,
        };

        const result = calculator.calculateWithBreakdown(violations, metrics, defaultDependencies);

        expect(result.breakdown.length).toBeGreaterThan(4);
        expect(result.rating).toBeLessThan(5);
      });
    });
  });

  describe('applyCircularDepPenalty', () => {
    it('should deduct 1.0 point per circular dependency', () => {
      const rating = calculator.applyCircularDepPenalty(10, 3);
      expect(rating).toBe(7);
    });

    it('should not go below 0', () => {
      const rating = calculator.applyCircularDepPenalty(2, 5);
      expect(rating).toBe(0);
    });

    it('should handle zero circular dependencies', () => {
      const rating = calculator.applyCircularDepPenalty(8, 0);
      expect(rating).toBe(8);
    });
  });

  describe('breakdown structure', () => {
    it('should include category, deduction, and detail in each breakdown item', () => {
      const violations: Violation[] = [{ type: 'error', severity: 'error', message: 'Error' }];
      
      const result = calculator.calculateWithBreakdown(violations, defaultMetrics, defaultDependencies);

      for (const item of result.breakdown) {
        expect(item).toHaveProperty('category');
        expect(item).toHaveProperty('deduction');
        expect(item).toHaveProperty('detail');
        expect(typeof item.category).toBe('string');
        expect(typeof item.deduction).toBe('number');
        expect(typeof item.detail).toBe('string');
      }
    });

    it('should explain the deduction formula in detail', () => {
      const violations: Violation[] = [
        { type: 'warning', severity: 'warning', message: 'W1' },
        { type: 'warning', severity: 'warning', message: 'W2' },
      ];

      const result = calculator.calculateWithBreakdown(violations, defaultMetrics, defaultDependencies);

      const warningBreakdown = result.breakdown.find(b => b.category.includes('Warnings'));
      expect(warningBreakdown?.detail).toContain('2 × −0.5 pts');
    });
  });
});
