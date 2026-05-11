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

    it('should recognize C# *Test.cs files', () => {
      expect((analyzer as any).isTestFile('/src/UserServiceTest.cs')).toBe(true);
    });

    it('should recognize C# *Tests.cs files', () => {
      expect((analyzer as any).isTestFile('/src/UserServiceTests.cs')).toBe(true);
    });

    it('should recognize C# *.Test.cs files', () => {
      expect((analyzer as any).isTestFile('/src/UserService.Test.cs')).toBe(true);
    });

    it('should recognize C# *.Tests.cs files', () => {
      expect((analyzer as any).isTestFile('/src/UserService.Tests.cs')).toBe(true);
    });

    it('should return false for regular C# source files', () => {
      expect((analyzer as any).isTestFile('/src/UserService.cs')).toBe(false);
      expect((analyzer as any).isTestFile('/src/Startup.cs')).toBe(false);
    });
  });

  describe('isConfigFile', () => {
    it('should recognize jest.config.* files', () => {
      expect((analyzer as any).isConfigFile('/project/jest.config.js')).toBe(true);
      expect((analyzer as any).isConfigFile('/project/jest.config.ts')).toBe(true);
    });

    it('should recognize vite.config.* files', () => {
      expect((analyzer as any).isConfigFile('/project/vite.config.ts')).toBe(true);
    });

    it('should recognize tsconfig*.json files', () => {
      expect((analyzer as any).isConfigFile('/project/tsconfig.json')).toBe(true);
      expect((analyzer as any).isConfigFile('/project/tsconfig.build.json')).toBe(true);
    });

    it('should recognize .eslintrc* files', () => {
      expect((analyzer as any).isConfigFile('/project/.eslintrc')).toBe(true);
      expect((analyzer as any).isConfigFile('/project/.eslintrc.json')).toBe(true);
    });

    it('should recognize package.json', () => {
      expect((analyzer as any).isConfigFile('/project/package.json')).toBe(true);
    });

    it('should return false for regular source files', () => {
      expect((analyzer as any).isConfigFile('/project/src/foo.ts')).toBe(false);
      expect((analyzer as any).isConfigFile('/project/src/Component.tsx')).toBe(false);
      expect((analyzer as any).isConfigFile('/project/src/Program.cs')).toBe(false);
    });
  });

  describe('isExcludedFromCoverage', () => {
    it('should return true for .cs files with [ExcludeFromCodeCoverage]', () => {
      const content = `
        using System.Diagnostics.CodeAnalysis;

        [ExcludeFromCodeCoverage]
        public class Startup {
          public void Configure() { }
        }
      `;
      const tempFile = '/tmp/test-exclude-coverage.cs';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).isExcludedFromCoverage(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should handle full attribute name [ExcludeFromCodeCoverageAttribute]', () => {
      const content = `
        [ExcludeFromCodeCoverageAttribute]
        public class Startup { }
      `;
      const tempFile = '/tmp/test-exclude-coverage-attr.cs';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).isExcludedFromCoverage(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should handle attribute with parameters', () => {
      const content = `
        [ExcludeFromCodeCoverage(Justification = "Legacy code")]
        public class Startup { }
      `;
      const tempFile = '/tmp/test-exclude-coverage-params.cs';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).isExcludedFromCoverage(tempFile)).toBe(true);
      require('fs').unlinkSync(tempFile);
    });

    it('should return false for .cs files without the attribute', () => {
      const content = `
        public class Startup {
          public void Configure() { }
        }
      `;
      const tempFile = '/tmp/test-no-exclude-coverage.cs';
      require('fs').writeFileSync(tempFile, content);
      expect((analyzer as any).isExcludedFromCoverage(tempFile)).toBe(false);
      require('fs').unlinkSync(tempFile);
    });

    it('should return false for non-.cs files', () => {
      expect((analyzer as any).isExcludedFromCoverage('/src/foo.ts')).toBe(false);
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

  describe('findProjectRoot', () => {
    const fs = require('fs');
    const path = require('path');

    it('should find directory containing package.json', () => {
      const tempDir = '/tmp/test-find-root-pkg';
      const subDir = path.join(tempDir, 'src', 'nested');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');

      const result = (analyzer as any).findProjectRoot(path.join(subDir, 'file.ts'));
      expect(result).toBe(tempDir);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should find directory containing .csproj', () => {
      const tempDir = '/tmp/test-find-root-csproj';
      const subDir = path.join(tempDir, 'src');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'App.csproj'), '<Project/>');

      const result = (analyzer as any).findProjectRoot(path.join(subDir, 'file.cs'));
      expect(result).toBe(tempDir);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('findLcovFile', () => {
    const fs = require('fs');
    const path = require('path');

    it('should find coverage/lcov.info', () => {
      const tempDir = '/tmp/test-find-lcov-1';
      fs.mkdirSync(path.join(tempDir, 'coverage'), { recursive: true });
      const lcovPath = path.join(tempDir, 'coverage', 'lcov.info');
      fs.writeFileSync(lcovPath, '');

      const result = (analyzer as any).findLcovFile(tempDir);
      expect(result).toBe(lcovPath);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return null when no LCOV present', () => {
      const tempDir = '/tmp/test-find-lcov-none';
      fs.mkdirSync(tempDir, { recursive: true });

      const result = (analyzer as any).findLcovFile(tempDir);
      expect(result).toBeNull();

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('loadCoverageData', () => {
    const fs = require('fs');
    const path = require('path');

    it('should parse and cache LCOV file', () => {
      const tempDir = '/tmp/test-load-cov';
      fs.mkdirSync(path.join(tempDir, 'coverage'), { recursive: true });
      const lcov = `SF:/x/foo.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n`;
      fs.writeFileSync(path.join(tempDir, 'coverage', 'lcov.info'), lcov);

      const map1 = (analyzer as any).loadCoverageData(tempDir);
      expect(map1).not.toBeNull();
      expect(map1.size).toBe(1);

      // Second call should hit the cache (same mtime)
      const map2 = (analyzer as any).loadCoverageData(tempDir);
      expect(map2).toBe(map1);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return null when no LCOV exists', () => {
      const tempDir = '/tmp/test-load-cov-empty';
      fs.mkdirSync(tempDir, { recursive: true });

      const result = (analyzer as any).loadCoverageData(tempDir);
      expect(result).toBeNull();

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('findTestFile', () => {
    const fs = require('fs');
    const path = require('path');

    it('should find sibling .test.ts file', () => {
      const tempDir = '/tmp/test-find-sibling';
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'foo.ts'), '');
      const testPath = path.join(tempDir, 'foo.test.ts');
      fs.writeFileSync(testPath, '');

      const result = (analyzer as any).findTestFile(path.join(tempDir, 'foo.ts'), tempDir);
      expect(result).toBe(testPath);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should find sibling C# Tests.cs file', () => {
      const tempDir = '/tmp/test-find-sibling-cs';
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'Foo.cs'), '');
      const testPath = path.join(tempDir, 'FooTests.cs');
      fs.writeFileSync(testPath, '');

      const result = (analyzer as any).findTestFile(path.join(tempDir, 'Foo.cs'), tempDir);
      expect(result).toBe(testPath);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should find test in __tests__ directory', () => {
      const tempDir = '/tmp/test-find-tests-dir';
      const testsDir = path.join(tempDir, '__tests__');
      fs.mkdirSync(testsDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'bar.ts'), '');
      const testPath = path.join(testsDir, 'bar.test.ts');
      fs.writeFileSync(testPath, '');

      const result = (analyzer as any).findTestFile(path.join(tempDir, 'bar.ts'), tempDir);
      expect(result).toBe(testPath);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return null when no test file exists', () => {
      const tempDir = '/tmp/test-find-none';
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'lonely.ts'), '');

      const result = (analyzer as any).findTestFile(path.join(tempDir, 'lonely.ts'), tempDir);
      expect(result).toBeNull();

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('removeDirSync', () => {
    const fs = require('fs');
    const path = require('path');

    it('should remove an existing directory recursively', () => {
      const tempDir = '/tmp/test-remove-dir';
      fs.mkdirSync(path.join(tempDir, 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'nested', 'a.txt'), 'x');

      (analyzer as any).removeDirSync(tempDir);
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('should silently ignore missing directories', () => {
      expect(() => (analyzer as any).removeDirSync('/tmp/does-not-exist-xyz')).not.toThrow();
    });
  });

  describe('checkCoverage (integration)', () => {
    const fs = require('fs');
    const path = require('path');

    it('should return null for test files', async () => {
      const result = await analyzer.checkCoverage('/src/foo.test.ts');
      expect(result).toBeNull();
    });

    it('should return null for config files', async () => {
      const result = await analyzer.checkCoverage('/project/jest.config.js');
      expect(result).toBeNull();
    });

    it('should return null when project root cannot be found', async () => {
      const tempDir = '/tmp/test-no-root-xyz';
      fs.mkdirSync(tempDir, { recursive: true });
      const result = await analyzer.checkCoverage(path.join(tempDir, 'foo.ts'));
      expect(result).toBeNull();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should warn no_test_coverage when LCOV exists but lacks this file', async () => {
      const tempDir = '/tmp/test-check-no-cov';
      fs.mkdirSync(path.join(tempDir, 'coverage'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'src.ts'), '');
      fs.writeFileSync(
        path.join(tempDir, 'coverage', 'lcov.info'),
        'SF:other.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n',
      );

      const result = await analyzer.checkCoverage(path.join(tempDir, 'src.ts'));
      expect(result?.violations[0].type).toBe('no_test_coverage');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should use LCOV data when present for the file', async () => {
      const tempDir = '/tmp/test-check-with-cov';
      fs.mkdirSync(path.join(tempDir, 'coverage'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const sourcePath = path.join(tempDir, 'src.ts');
      fs.writeFileSync(sourcePath, '');
      fs.writeFileSync(
        path.join(tempDir, 'coverage', 'lcov.info'),
        `SF:${sourcePath}\nDA:1,1\nDA:2,1\nLF:2\nLH:2\nend_of_record\n`,
      );

      const result = await analyzer.checkCoverage(sourcePath);
      expect(result?.coveragePercent).toBe(100);
      expect(result?.violations.length).toBe(0);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should warn no_test_file when no LCOV and no sibling test', async () => {
      const tempDir = '/tmp/test-check-no-test';
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const sourcePath = path.join(tempDir, 'orphan.ts');
      fs.writeFileSync(sourcePath, '');

      const result = await analyzer.checkCoverage(sourcePath);
      expect(result?.violations[0].type).toBe('no_test_file');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should error hollow_test_file when test file has no real assertions', async () => {
      const tempDir = '/tmp/test-check-hollow';
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const sourcePath = path.join(tempDir, 'thing.ts');
      fs.writeFileSync(sourcePath, '');
      fs.writeFileSync(path.join(tempDir, 'thing.test.ts'), '// nothing here\n');

      const result = await analyzer.checkCoverage(sourcePath);
      expect(result?.violations[0].type).toBe('hollow_test_file');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should skip [ExcludeFromCodeCoverage] C# files', async () => {
      const tempDir = '/tmp/test-check-excluded';
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'App.csproj'), '<Project/>');
      const sourcePath = path.join(tempDir, 'Excluded.cs');
      fs.writeFileSync(sourcePath, '[ExcludeFromCodeCoverage]\npublic class X {}\n');

      const result = await analyzer.checkCoverage(sourcePath);
      expect(result).toBeNull();

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('buildRunnerArgs (nyc)', () => {
    it('should return null for nyc runner', () => {
      const args = (analyzer as any).buildRunnerArgs('nyc', '/x/foo.test.ts', 'x/foo.ts', '/tmp/cov');
      expect(args).toBeNull();
    });
  });

  describe('detectTestRunner edge cases', () => {
    const fs = require('fs');
    it('should return null when package.json is missing', () => {
      const result = (analyzer as any).detectTestRunner('/tmp/test-no-pkg-xyz');
      expect(result).toBeNull();
    });

    it('should return null when package.json is malformed', () => {
      const tempDir = '/tmp/test-bad-pkg';
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(tempDir + '/package.json', '{not json');

      const result = (analyzer as any).detectTestRunner(tempDir);
      expect(result).toBeNull();

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect nyc/c8', () => {
      const tempDir = '/tmp/test-nyc-detect';
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(tempDir + '/package.json', JSON.stringify({ devDependencies: { c8: '^8.0.0' } }));

      const result = (analyzer as any).detectTestRunner(tempDir);
      expect(result).toBe('nyc');

      fs.rmSync(tempDir, { recursive: true, force: true });
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
