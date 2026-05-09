import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Violation } from '../types';

const execFileAsync = promisify(execFile);

export interface FileCoverage {
    filePath: string;
    /** Map of line number → execution count */
    lines: Map<number, number>;
    /** Total instrumented lines */
    linesFound: number;
    /** Lines with at least one execution */
    linesHit: number;
    /** Coverage percentage 0–100 */
    coveragePercent: number;
}

export interface CoverageResult {
    /** undefined when coverage was not measured (no test file, hollow test, etc.) */
    coveragePercent?: number;
    uncoveredLines: number[];
    violations: Violation[];
}

/**
 * Parses test coverage data (LCOV format) and produces violations
 * for files with low or missing coverage.
 *
 * Searches upward from the analyzed file's directory for common
 * coverage report locations produced by Jest, Istanbul/NYC, Vitest, etc.
 */
export class CoverageAnalyzer {
    /** Cache: project root → parsed coverage map */
    private coverageCache = new Map<string, Map<string, FileCoverage>>();

    /** Max time (ms) to wait for a test runner to produce coverage. */
    private static readonly RUNNER_TIMEOUT_MS = 30_000;

    /**
     * Check coverage for a given source file.
     * 1. Uses existing LCOV data when available.
     * 2. If no LCOV exists but a test file is found, runs that test with
     *    coverage to generate LCOV on the fly for the file.
     * 3. Falls back to a "no test file" warning when nothing is found.
     */
    async checkCoverage(filePath: string): Promise<CoverageResult | null> {
        if (this.isTestFile(filePath)) return null;

        const projectRoot = this.findProjectRoot(filePath);
        if (!projectRoot) return null;

        // 1. Try pre-existing LCOV
        const coverageMap = this.loadCoverageData(projectRoot);

        if (coverageMap) {
            const normalizedPath = path.resolve(filePath);
            const fileCoverage = this.findFileCoverage(coverageMap, normalizedPath);

            if (!fileCoverage) {
                return {
                    coveragePercent: 0,
                    uncoveredLines: [],
                    violations: [
                        {
                            type: 'no_test_coverage',
                            severity: 'warning',
                            message: 'File has no unit test coverage — add tests for this file',
                            fix: 'Create a corresponding .test.ts or .spec.ts file with unit tests',
                        },
                    ],
                };
            }

            return this.buildCoverageResult(fileCoverage);
        }

        // 2. No LCOV — check if a test file exists
        const testFile = this.findTestFile(filePath, projectRoot);
        if (!testFile) {
            return {
                coveragePercent: undefined,
                uncoveredLines: [],
                violations: [
                    {
                        type: 'no_test_file',
                        severity: 'warning',
                        message: 'No corresponding test file found — add tests for this file',
                        fix: `Create a test file (e.g. ${this.suggestTestFileName(filePath)})`,
                    },
                ],
            };
        }

        // 3. Test file found — verify it contains real tests before running coverage
        if (!this.hasRealTestContent(testFile)) {
            return {
                coveragePercent: undefined,
                uncoveredLines: [],
                violations: [
                    {
                        type: 'hollow_test_file',
                        severity: 'error',
                        message: `Test file exists but contains no real test cases — ${path.basename(testFile)} is an empty shell`,
                        fix: 'Add at least one it() / test() / describe() block with assertions',
                    },
                ],
            };
        }

        // 4. Real test file found — run coverage for this file on the fly
        return this.runCoverageForFile(filePath, testFile, projectRoot);
    }

    /**
     * Build a CoverageResult from parsed LCOV file coverage data.
     */
    private buildCoverageResult(fileCoverage: FileCoverage): CoverageResult {

        const violations: Violation[] = [];
        const uncoveredLines = [...fileCoverage.lines.entries()]
            .filter(([, count]) => count === 0)
            .map(([line]) => line)
            .sort((a, b) => a - b);

        const pct = fileCoverage.coveragePercent;

        if (pct < 50) {
            violations.push({
                type: 'low_test_coverage',
                severity: 'warning',
                message: `Test coverage is ${pct.toFixed(1)}% — aim for at least 80%`,
                fix: 'Add unit tests covering the uncovered lines/branches',
            });
        } else if (pct < 80) {
            violations.push({
                type: 'moderate_test_coverage',
                severity: 'info',
                message: `Test coverage is ${pct.toFixed(1)}% — consider improving to 80%+`,
                fix: 'Add tests for uncovered edge cases and error paths',
            });
        }

        if (uncoveredLines.length > 0) {
            const ranges = this.compactLineRanges(uncoveredLines);
            violations.push({
                type: 'uncovered_lines',
                severity: 'info',
                message: `${uncoveredLines.length} lines not covered by tests: ${ranges}`,
                fix: 'Write tests that exercise these code paths',
            });
        }

        return { coveragePercent: pct, uncoveredLines, violations };
    }

    /**
     * Detect which test runner is available in the project.
     * Returns the runner name or null.
     */
    private detectTestRunner(projectRoot: string): 'jest' | 'vitest' | 'nyc' | null {
        const pkgPath = path.join(projectRoot, 'package.json');
        if (!fs.existsSync(pkgPath)) return null;

        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies,
            };

            if (allDeps['vitest']) return 'vitest';
            if (allDeps['jest'] || allDeps['ts-jest']) return 'jest';
            if (allDeps['nyc'] || allDeps['c8']) return 'nyc';
        } catch {
            // Ignore parse errors
        }
        return null;
    }

    /**
     * Run the test file with coverage enabled and parse the resulting LCOV
     * to get per-line coverage for the source file.
     */
    private async runCoverageForFile(
        sourceFile: string,
        testFile: string,
        projectRoot: string,
    ): Promise<CoverageResult | null> {
        const runner = this.detectTestRunner(projectRoot);
        if (!runner) return null;

        const resolvedSource = path.resolve(sourceFile);
        const relativeSource = path.relative(projectRoot, resolvedSource);
        const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const tmpDir = path.join(projectRoot, '.gate-keeper-cov');

        const args = this.buildRunnerArgs(runner, testFile, relativeSource, tmpDir);
        if (!args) return null;

        try {
            await execFileAsync(npxBin, args, {
                cwd: projectRoot,
                timeout: CoverageAnalyzer.RUNNER_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
                env: { ...process.env, NODE_ENV: 'test' },
            });
        } catch {
            // Test failures and timeouts are okay — coverage may still have been generated
        }

        const lcovPath = path.join(tmpDir, 'lcov.info');
        if (!fs.existsSync(lcovPath)) return null;

        try {
            const lcov = fs.readFileSync(lcovPath, 'utf8');
            const coverageMap = this.parseLcov(lcov, projectRoot);
            const fileCoverage = this.findFileCoverage(coverageMap, resolvedSource);

            // Clean up temp coverage dir
            this.removeDirSync(tmpDir);

            if (!fileCoverage) {
                return {
                    coveragePercent: 0,
                    uncoveredLines: [],
                    violations: [{
                        type: 'no_test_coverage',
                        severity: 'warning',
                        message: 'Test file exists but does not cover this file — update tests',
                        fix: 'Ensure the test file imports and exercises the source file',
                    }],
                };
            }

            return this.buildCoverageResult(fileCoverage);
        } catch {
            this.removeDirSync(tmpDir);
            return null;
        }
    }

    /**
     * Build CLI arguments for the test runner.
     */
    private buildRunnerArgs(
        runner: 'jest' | 'vitest' | 'nyc',
        testFile: string,
        relativeSource: string,
        coverageDir: string,
    ): string[] | null {
        switch (runner) {
            case 'jest':
                return [
                    'jest', '--no-cache', '--coverage',
                    '--coverageReporters', 'lcovonly',
                    '--coverageDirectory', coverageDir,
                    '--collectCoverageFrom', relativeSource,
                    '--', testFile,
                ];
            case 'vitest':
                return [
                    'vitest', 'run', '--coverage',
                    '--coverage.reporter', 'lcov',
                    '--coverage.reportsDirectory', coverageDir,
                    '--coverage.include', relativeSource,
                    testFile,
                ];
            case 'nyc':
                return null; // nyc wraps other runners — too variable to auto-invoke
        }
    }

    /**
     * Recursively remove a directory (sync). Safe for temp cleanup.
     */
    private removeDirSync(dirPath: string): void {
        try {
            fs.rmSync(dirPath, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup
        }
    }

    /**
     * Find the project root by searching upward for package.json or .csproj.
     */
    private findProjectRoot(filePath: string): string | null {
        let dir = path.dirname(path.resolve(filePath));
        const root = path.parse(dir).root;

        while (dir !== root) {
            if (
                fs.existsSync(path.join(dir, 'package.json')) ||
                fs.readdirSync(dir).some(f => f.endsWith('.csproj') || f.endsWith('.sln'))
            ) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        return null;
    }

    /**
     * Load and cache coverage data for a project root.
     * Searches for LCOV files in common locations.
     */
    private loadCoverageData(projectRoot: string): Map<string, FileCoverage> | null {
        if (this.coverageCache.has(projectRoot)) {
            return this.coverageCache.get(projectRoot)!;
        }

        const lcovPath = this.findLcovFile(projectRoot);
        if (!lcovPath) return null;

        try {
            const content = fs.readFileSync(lcovPath, 'utf8');
            const coverageMap = this.parseLcov(content, projectRoot);
            this.coverageCache.set(projectRoot, coverageMap);
            return coverageMap;
        } catch {
            return null;
        }
    }

    /**
     * Search common locations for an LCOV coverage report.
     */
    private findLcovFile(projectRoot: string): string | null {
        const candidates = [
            path.join(projectRoot, 'coverage', 'lcov.info'),
            path.join(projectRoot, 'coverage', 'lcov-report', 'lcov.info'),
            path.join(projectRoot, 'lcov.info'),
            path.join(projectRoot, '.coverage', 'lcov.info'),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) return candidate;
        }
        return null;
    }

    /**
     * Parse LCOV format into a map of file path → coverage data.
     *
     * LCOV records look like:
     *   SF:/path/to/file.ts
     *   DA:1,5
     *   DA:2,0
     *   LF:10
     *   LH:8
     *   end_of_record
     */
    private parseLcov(content: string, projectRoot?: string): Map<string, FileCoverage> {
        const coverageMap = new Map<string, FileCoverage>();
        const records = content.split('end_of_record');

        for (const record of records) {
            const trimmed = record.trim();
            if (!trimmed) continue;

            const sfMatch = trimmed.match(/^SF:(.+)$/m);
            if (!sfMatch) continue;

            const rawPath = sfMatch[1].trim();
            // Jest/Istanbul emit project-relative SF paths; resolve against projectRoot
            // so they match the absolute paths used elsewhere in the analyzer.
            const filePath = path.isAbsolute(rawPath)
                ? rawPath
                : path.resolve(projectRoot ?? process.cwd(), rawPath);
            const lines = new Map<number, number>();
            let linesFound = 0;
            let linesHit = 0;

            for (const line of trimmed.split('\n')) {
                const daMatch = line.match(/^DA:(\d+),(\d+)/);
                if (daMatch) {
                    const lineNum = parseInt(daMatch[1], 10);
                    const count = parseInt(daMatch[2], 10);
                    lines.set(lineNum, count);
                }

                const lfMatch = line.match(/^LF:(\d+)/);
                if (lfMatch) linesFound = parseInt(lfMatch[1], 10);

                const lhMatch = line.match(/^LH:(\d+)/);
                if (lhMatch) linesHit = parseInt(lhMatch[1], 10);
            }

            // If LF/LH weren't in the record, compute from DA entries
            if (linesFound === 0 && lines.size > 0) {
                linesFound = lines.size;
                linesHit = [...lines.values()].filter(c => c > 0).length;
            }

            const coveragePercent = linesFound > 0
                ? Math.round((linesHit / linesFound) * 1000) / 10
                : 100;

            coverageMap.set(filePath, { filePath, lines, linesFound, linesHit, coveragePercent });
        }

        return coverageMap;
    }

    /**
     * Find coverage for a file, trying both exact match and relative path matching.
     */
    private findFileCoverage(
        coverageMap: Map<string, FileCoverage>,
        filePath: string
    ): FileCoverage | null {
        // Exact match
        if (coverageMap.has(filePath)) return coverageMap.get(filePath)!;

        // Try matching by basename + partial path (coverage tools sometimes use relative paths)
        const normalized = filePath.replace(/\\/g, '/');
        for (const [covPath, covData] of coverageMap) {
            const normalizedCov = covPath.replace(/\\/g, '/');
            if (normalizedCov.endsWith(normalized) || normalized.endsWith(normalizedCov)) {
                return covData;
            }
            // Match on last N path segments
            const fileParts = normalized.split('/');
            const covParts = normalizedCov.split('/');
            const minLen = Math.min(fileParts.length, covParts.length, 3);
            const fileTail = fileParts.slice(-minLen).join('/');
            const covTail = covParts.slice(-minLen).join('/');
            if (fileTail === covTail) return covData;
        }

        return null;
    }

    /**
     * Compact line numbers into readable ranges: [1,2,3,5,7,8,9] → "1-3, 5, 7-9"
     */
    private compactLineRanges(lines: number[]): string {
        if (lines.length === 0) return '';
        const ranges: string[] = [];
        let start = lines[0];
        let end = lines[0];

        for (let i = 1; i < lines.length; i++) {
            if (lines[i] === end + 1) {
                end = lines[i];
            } else {
                ranges.push(start === end ? `${start}` : `${start}-${end}`);
                start = lines[i];
                end = lines[i];
            }
        }
        ranges.push(start === end ? `${start}` : `${start}-${end}`);

        // Truncate if too many ranges
        if (ranges.length > 10) {
            return ranges.slice(0, 10).join(', ') + ` (+${ranges.length - 10} more)`;
        }
        return ranges.join(', ');
    }

    /** Patterns that identify test/spec files. */
    private static readonly TEST_PATTERNS = [
        /\.test\.[jt]sx?$/,
        /\.spec\.[jt]sx?$/,
        /__tests__\//,
        /\.tests\.[jt]sx?$/,
        /\.specs\.[jt]sx?$/,
    ];

    /**
     * Returns true if the file is itself a test/spec file.
     */
    private isTestFile(filePath: string): boolean {
        const normalized = filePath.replace(/\\/g, '/');
        return CoverageAnalyzer.TEST_PATTERNS.some(p => p.test(normalized));
    }

    /**
     * Search for a corresponding test file for the given source file.
     * Checks sibling locations, `__tests__/` directories, and `tests/` folders.
     */
    private findTestFile(filePath: string, projectRoot: string): string | null {
        const resolved = path.resolve(filePath);
        const dir = path.dirname(resolved);
        const ext = path.extname(resolved);
        const baseName = path.basename(resolved, ext);

        const testSuffixes = ['.test', '.spec'];
        const testExts = [ext, '.ts', '.tsx', '.js', '.jsx'];

        // 1. Sibling: foo.test.ts next to foo.ts
        for (const suffix of testSuffixes) {
            for (const testExt of testExts) {
                const candidate = path.join(dir, `${baseName}${suffix}${testExt}`);
                if (fs.existsSync(candidate)) return candidate;
            }
        }

        // 2. __tests__/ directory at the same level
        const testsDir = path.join(dir, '__tests__');
        if (fs.existsSync(testsDir)) {
            for (const suffix of ['', ...testSuffixes]) {
                for (const testExt of testExts) {
                    const candidate = path.join(testsDir, `${baseName}${suffix}${testExt}`);
                    if (fs.existsSync(candidate)) return candidate;
                }
            }
        }

        // 3. Parallel tests/ or test/ folder at project root
        for (const testFolder of ['tests', 'test', '__tests__']) {
            const rootTestDir = path.join(projectRoot, testFolder);
            if (!fs.existsSync(rootTestDir)) continue;

            const relativePath = path.relative(projectRoot, dir);
            const parallelDir = path.join(rootTestDir, relativePath);
            if (!fs.existsSync(parallelDir)) continue;

            for (const suffix of ['', ...testSuffixes]) {
                for (const testExt of testExts) {
                    const candidate = path.join(parallelDir, `${baseName}${suffix}${testExt}`);
                    if (fs.existsSync(candidate)) return candidate;
                }
            }
        }

        return null;
    }

    /**
     * Suggest a test file name for the given source file path.
     */
    private suggestTestFileName(filePath: string): string {
        const ext = path.extname(filePath);
        const baseName = path.basename(filePath, ext);
        return `${baseName}.test${ext}`;
    }

    /**
     * Returns true if a test file contains at least one real test assertion or
     * test-framework call. Catches empty/placeholder test files that would
     * otherwise satisfy the "test file exists" check without actually testing anything.
     */
    private hasRealTestContent(testFilePath: string): boolean {
        try {
            const content = fs.readFileSync(testFilePath, 'utf8');

            // TypeScript / JavaScript test patterns
            const jsTestPatterns = [
                /\bit\s*\(/,         // it('...')
                /\btest\s*\(/,       // test('...')
                /\bdescribe\s*\(/,   // describe('...')
                /\bexpect\s*\(/,     // expect(...)
                /\bassert\./,        // assert.equal / assert.ok / etc.
                /\bshould\./,        // chai .should chains
                /\bsuiteTest\s*\(/,
                /\bspecify\s*\(/,
            ];

            // C# xUnit / NUnit / MSTest attributes and Assert calls
            const csharpTestPatterns = [
                /\[Test\]/,
                /\[TestMethod\]/,
                /\[Fact\]/,
                /\[Theory\]/,
                /\[DataTestMethod\]/,
                /\bAssert\./,
                /\bShould\./,
            ];

            const allPatterns = [...jsTestPatterns, ...csharpTestPatterns];
            return allPatterns.some(p => p.test(content));
        } catch {
            // If we can't read the file, assume it's real to avoid false positives
            return true;
        }
    }

    /** Clear the coverage cache (e.g., when coverage files are regenerated). */
    clearCache(): void {
        this.coverageCache.clear();
    }
}
