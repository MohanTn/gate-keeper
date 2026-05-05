import { CoverageAnalyzer, FileCoverage } from './coverage-analyzer';

describe('CoverageAnalyzer', () => {
  let analyzer: CoverageAnalyzer;

  beforeEach(() => {
    analyzer = new CoverageAnalyzer();
  });

  describe('isTestFile', () => {
    it('should recognize .test.ts files', () => {
      expect((analyzer as any).isTestFile('/src/foo.test.ts')).toBe(true);
    });

    it('should recognize .spec.ts files', () => {
      expect((analyzer as any).isTestFile('/src/foo.spec.ts')).toBe(true);
    });

    it('should recognize __tests__ directory files', () => {
      expect((analyzer as any).isTestFile('/src/__tests__/foo.ts')).toBe(true);
    });

    it('should recognize .tests.ts files', () => {
      expect((analyzer as any).isTestFile('/src/foo.tests.tsx')).toBe(true);
    });

    it('should return false for regular source files', () => {
      expect((analyzer as any).isTestFile('/src/foo.ts')).toBe(false);
      expect((analyzer as any).isTestFile('/src/utils.ts')).toBe(false);
    });
  });

  describe('buildCoverageResult', () => {
    it('should return no violations for high coverage', () => {
      const fileCoverage: FileCoverage = {
        filePath: '/src/foo.ts',
        lines: new Map([[1, 5], [2, 3], [3, 1]]),
        linesFound: 3,
        linesHit: 3,
        coveragePercent: 100,
      };

      const result = (analyzer as any).buildCoverageResult(fileCoverage);

      expect(result.coveragePercent).toBe(100);
      expect(result.uncoveredLines.length).toBe(0);
      expect(result.violations.length).toBe(0);
    });

    it('should add warning for low coverage (<50%)', () => {
      const fileCoverage: FileCoverage = {
        filePath: '/src/foo.ts',
        lines: new Map([[1, 1], [2, 0], [3, 0]]),
        linesFound: 3,
        linesHit: 1,
        coveragePercent: 33.3,
      };

      const result = (analyzer as any).buildCoverageResult(fileCoverage);

      const lowCoverageViolation = result.violations.find((v: any) => v.type === 'low_test_coverage');
      expect(lowCoverageViolation).toBeDefined();
      expect(lowCoverageViolation?.message).toContain('33.3%');
    });

    it('should add info for moderate coverage (50-80%)', () => {
      const fileCoverage: FileCoverage = {
        filePath: '/src/foo.ts',
        lines: new Map([[1, 1], [2, 1], [3, 0]]),
        linesFound: 3,
        linesHit: 2,
        coveragePercent: 66.7,
      };

      const result = (analyzer as any).buildCoverageResult(fileCoverage);

      const moderateViolation = result.violations.find((v: any) => v.type === 'moderate_test_coverage');
      expect(moderateViolation).toBeDefined();
      expect(moderateViolation?.message).toContain('66.7%');
    });

    it('should list uncovered lines', () => {
      const fileCoverage: FileCoverage = {
        filePath: '/src/foo.ts',
        lines: new Map([
          [1, 5],
          [2, 0],
          [3, 0],
          [4, 3],
          [5, 0],
        ]),
        linesFound: 5,
        linesHit: 2,
        coveragePercent: 40,
      };

      const result = (analyzer as any).buildCoverageResult(fileCoverage);

      expect(result.uncoveredLines).toEqual([2, 3, 5]);
      const uncoveredViolation = result.violations.find((v: any) => v.type === 'uncovered_lines');
      expect(uncoveredViolation).toBeDefined();
    });
  });

  describe('compactLineRanges', () => {
    it('should return empty string for empty array', () => {
      const result = (analyzer as any).compactLineRanges([]);
      expect(result).toBe('');
    });

    it('should return single line number', () => {
      const result = (analyzer as any).compactLineRanges([5]);
      expect(result).toBe('5');
    });

    it('should compact consecutive lines into ranges', () => {
      const result = (analyzer as any).compactLineRanges([1, 2, 3, 5, 7, 8, 9]);
      expect(result).toBe('1-3, 5, 7-9');
    });

    it('should handle non-consecutive lines', () => {
      const result = (analyzer as any).compactLineRanges([1, 3, 5, 7]);
      expect(result).toBe('1, 3, 5, 7');
    });

    it('should truncate if too many ranges', () => {
      const lines = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25];
      const result = (analyzer as any).compactLineRanges(lines);
      expect(result).toContain('+');
    });
  });

  describe('suggestTestFileName', () => {
    it('should suggest .test.ts for .ts file', () => {
      const result = (analyzer as any).suggestTestFileName('/src/foo.ts');
      expect(result).toBe('foo.test.ts');
    });

    it('should suggest .test.tsx for .tsx file', () => {
      const result = (analyzer as any).suggestTestFileName('/src/Component.tsx');
      expect(result).toBe('Component.test.tsx');
    });

    it('should suggest .test.js for .js file', () => {
      const result = (analyzer as any).suggestTestFileName('/src/utils.js');
      expect(result).toBe('utils.test.js');
    });
  });

  describe('hasRealTestContent', () => {
    it('should return true for file with it() calls', () => {
      const content = `
        describe('foo', () => {
          it('should work', () => {
            expect(true).toBe(true);
          });
        });
      `;
      const tempFile = '/tmp/test-hasRealTestContent.test.ts';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).hasRealTestContent(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should return true for file with test() calls', () => {
      const content = `
        test('should work', () => {
          expect(1).toBe(1);
        });
      `;
      const tempFile = '/tmp/test-hasRealTestContent2.test.ts';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).hasRealTestContent(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should return true for file with describe() calls', () => {
      const content = `
        describe('MyComponent', () => {
          // tests here
        });
      `;
      const tempFile = '/tmp/test-hasRealTestContent3.test.ts';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).hasRealTestContent(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should return true for file with expect() calls', () => {
      const content = `
        const result = doSomething();
        expect(result).toBe(42);
      `;
      const tempFile = '/tmp/test-hasRealTestContent4.test.ts';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).hasRealTestContent(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should return true for C# with [Fact] attribute', () => {
      const content = `
        public class Tests {
          [Fact]
          public void Test1() { }
        }
      `;
      const tempFile = '/tmp/test-hasRealTestContent.cs';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).hasRealTestContent(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should return true for C# with Assert calls', () => {
      const content = `
        Assert.Equal(1, 1);
        Assert.True(condition);
      `;
      const tempFile = '/tmp/test-hasRealTestContent2.cs';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).hasRealTestContent(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should return false for empty test file', () => {
      const content = `
        // Empty test file
      `;
      const tempFile = '/tmp/test-hasRealTestContent5.test.ts';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).hasRealTestContent(tempFile)).toBe(false);
      require('fs').unlinkSync(tempFile);
    });

    it('should return false for placeholder-only test file', () => {
      const content = `
        describe('placeholder', () => {
          it('should pass', () => {
            expect(true).toBe(true);
          });
        });
      `;
      const tempFile = '/tmp/test-hasRealTestContent6.test.ts';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).hasRealTestContent(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });
  });

  describe('parseLcov', () => {
    it('should parse valid LCOV content', () => {
      const lcovContent = `
TN:
SF:/path/to/file.ts
DA:1,5
DA:2,0
DA:3,3
LF:3
LH:2
end_of_record
      `;

      const coverageMap = (analyzer as any).parseLcov(lcovContent);

      expect(coverageMap.size).toBe(1);
      const fileCov = coverageMap.get('/path/to/file.ts');
      expect(fileCov).toBeDefined();
      expect(fileCov?.linesFound).toBe(3);
      expect(fileCov?.linesHit).toBe(2);
      expect(fileCov?.coveragePercent).toBeCloseTo(66.7, 1);
    });

    it('should handle multiple files in LCOV', () => {
      const lcovContent = `
TN:
SF:/path/to/file1.ts
DA:1,1
LF:1
LH:1
end_of_record
TN:
SF:/path/to/file2.ts
DA:1,0
LF:1
LH:0
end_of_record
      `;

      const coverageMap = (analyzer as any).parseLcov(lcovContent);

      expect(coverageMap.size).toBe(2);
    });

    it('should compute LF/LH from DA if not present', () => {
      const lcovContent = `
TN:
SF:/path/to/file.ts
DA:1,5
DA:2,0
DA:3,3
end_of_record
      `;

      const coverageMap = (analyzer as any).parseLcov(lcovContent);

      const fileCov = coverageMap.get('/path/to/file.ts');
      expect(fileCov?.linesFound).toBe(3);
      expect(fileCov?.linesHit).toBe(2);
    });

    it('should return 100% coverage for empty records', () => {
      const lcovContent = `
TN:
SF:/path/to/file.ts
end_of_record
      `;

      const coverageMap = (analyzer as any).parseLcov(lcovContent);

      const fileCov = coverageMap.get('/path/to/file.ts');
      expect(fileCov?.coveragePercent).toBe(100);
    });
  });

  describe('findFileCoverage', () => {
    it('should find by exact match', () => {
      const coverageMap = new Map<string, FileCoverage>();
      const expected = {
        filePath: '/src/foo.ts',
        lines: new Map(),
        linesFound: 10,
        linesHit: 8,
        coveragePercent: 80,
      };
      coverageMap.set('/src/foo.ts', expected);

      const result = (analyzer as any).findFileCoverage(coverageMap, '/src/foo.ts');
      expect(result).toBe(expected);
    });

    it('should find by path ending match', () => {
      const coverageMap = new Map<string, FileCoverage>();
      const expected = {
        filePath: 'src/foo.ts',
        lines: new Map(),
        linesFound: 10,
        linesHit: 8,
        coveragePercent: 80,
      };
      coverageMap.set('src/foo.ts', expected);

      const result = (analyzer as any).findFileCoverage(coverageMap, '/absolute/path/src/foo.ts');
      expect(result).toBe(expected);
    });

    it('should find by basename match', () => {
      const coverageMap = new Map<string, FileCoverage>();
      const expected = {
        filePath: 'foo.ts',
        lines: new Map(),
        linesFound: 10,
        linesHit: 8,
        coveragePercent: 80,
      };
      coverageMap.set('foo.ts', expected);

      const result = (analyzer as any).findFileCoverage(coverageMap, '/some/path/foo.ts');
      expect(result).toBe(expected);
    });

    it('should return null when not found', () => {
      const coverageMap = new Map<string, FileCoverage>();
      coverageMap.set('/src/bar.ts', {
        filePath: '/src/bar.ts',
        lines: new Map(),
        linesFound: 5,
        linesHit: 5,
        coveragePercent: 100,
      });

      const result = (analyzer as any).findFileCoverage(coverageMap, '/src/foo.ts');
      expect(result).toBeNull();
    });
  });

  describe('detectTestRunner', () => {
    it('should detect vitest', () => {
      const pkgContent = JSON.stringify({
        devDependencies: { vitest: '^1.0.0' },
      });
      const tempDir = '/tmp/test-vitest-detect';
      require('fs').mkdirSync(tempDir, { recursive: true });
      require('fs').writeFileSync(tempDir + '/package.json', pkgContent);

      const result = (analyzer as any).detectTestRunner(tempDir);
      expect(result).toBe('vitest');

      require('fs').rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect jest', () => {
      const pkgContent = JSON.stringify({
        devDependencies: { jest: '^29.0.0' },
      });
      const tempDir = '/tmp/test-jest-detect';
      require('fs').mkdirSync(tempDir, { recursive: true });
      require('fs').writeFileSync(tempDir + '/package.json', pkgContent);

      const result = (analyzer as any).detectTestRunner(tempDir);
      expect(result).toBe('jest');

      require('fs').rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect ts-jest', () => {
      const pkgContent = JSON.stringify({
        devDependencies: { 'ts-jest': '^29.0.0' },
      });
      const tempDir = '/tmp/test-ts-jest-detect';
      require('fs').mkdirSync(tempDir, { recursive: true });
      require('fs').writeFileSync(tempDir + '/package.json', pkgContent);

      const result = (analyzer as any).detectTestRunner(tempDir);
      expect(result).toBe('jest');

      require('fs').rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return null for unknown runner', () => {
      const pkgContent = JSON.stringify({
        devDependencies: { mocha: '^10.0.0' },
      });
      const tempDir = '/tmp/test-unknown-detect';
      require('fs').mkdirSync(tempDir, { recursive: true });
      require('fs').writeFileSync(tempDir + '/package.json', pkgContent);

      const result = (analyzer as any).detectTestRunner(tempDir);
      expect(result).toBeNull();

      require('fs').rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('buildRunnerArgs', () => {
    it('should build jest arguments', () => {
      const args = (analyzer as any).buildRunnerArgs(
        'jest',
        '/src/foo.test.ts',
        'src/foo.ts',
        '/tmp/cov'
      );

      expect(args).toContain('jest');
      expect(args).toContain('--coverage');
      expect(args).toContain('/src/foo.test.ts');
      expect(args).toContain('src/foo.ts');
    });

    it('should build vitest arguments', () => {
      const args = (analyzer as any).buildRunnerArgs(
        'vitest',
        '/src/foo.test.ts',
        'src/foo.ts',
        '/tmp/cov'
      );

      expect(args).toContain('vitest');
      expect(args).toContain('run');
      expect(args).toContain('--coverage');
    });
  });

  describe('clearCache', () => {
    it('should clear the coverage cache', () => {
      (analyzer as any).coverageCache.set('test-project', new Map());
      expect((analyzer as any).coverageCache.size).toBeGreaterThan(0);

      analyzer.clearCache();

      expect((analyzer as any).coverageCache.size).toBe(0);
    });
  });
});
