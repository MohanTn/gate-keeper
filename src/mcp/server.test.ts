/**
 * MCP Server Tests
 *
 * Tests for the MCP server tool handlers and helpers.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  handleAnalyzeFile,
  handleAnalyzeCode,
  handleQualityRules,
  handleToolCall,
  handleCodebaseHealth,
  handleFileContext,
  handleDependencyGraph,
  handleImpactAnalysis,
  handleSuggestRefactoring,
  handlePredictImpactWithRemediation,
  handleViolationPatterns,
  text,
} from './handlers';
import { getMinRating, findGitRoot, formatAnalysisResult, formatStringResult, findSourceFiles } from './helpers';

// ── Mock Test File ──────────────────────────────────────────

const TEST_CODE_CLEAN = `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`;

const TEST_CODE_WITH_VIOLATIONS = `
export function processData(data: any): any {
  console.log('Processing data');
  return data;
}
`;

// ── Mock Daemon API ─────────────────────────────────────────

const mockGraphResponse = {
  nodes: [
    {
      id: '/test/file.ts',
      label: 'file.ts',
      type: 'typescript',
      rating: 7.5,
      size: 100,
      violations: [{ type: 'any_usage', severity: 'warning', message: 'test' }],
      metrics: {
        linesOfCode: 50,
        cyclomaticComplexity: 5,
        numberOfMethods: 3,
        numberOfClasses: 1,
        importCount: 2,
      },
    },
    {
      id: '/test/other.ts',
      label: 'other.ts',
      type: 'typescript',
      rating: 6.0,
      size: 80,
      violations: [],
      metrics: {
        linesOfCode: 30,
        cyclomaticComplexity: 3,
        numberOfMethods: 2,
        numberOfClasses: 0,
        importCount: 1,
      },
    },
  ],
  edges: [
    { source: '/test/other.ts', target: '/test/file.ts', type: 'import', strength: 1 },
  ],
};

const mockCyclesResponse = [
  { nodes: ['/test/file.ts', '/test/other.ts'] },
];

const mockTrendsResponse = [
  { rating: 7.0, recorded_at: '2024-01-01' },
  { rating: 7.5, recorded_at: '2024-01-02' },
];

const mockFileDetailResponse = {
  analysis: { rating: 7.5, violations: [] },
  ratingBreakdown: [{ category: 'violations', deduction: 0.5, detail: 'test' }],
  gitDiff: { added: 5, removed: 3 },
};

const mockStatusResponse = { overallRating: 7.0 };

const mockPatternsResponse = [
  {
    violationType: 'any_usage',
    severity: 'warning',
    fileCount: 5,
    totalOccurrences: 10,
    estimatedRatingGain: 2.5,
    affectedFiles: ['/test/file1.ts', '/test/file2.ts'],
    moduleSuggestion: 'Replace any with specific types',
  },
];

// Mock fetchDaemonApi
jest.mock('./helpers', () => {
  const original = jest.requireActual('./helpers');
  return {
    ...original,
    fetchDaemonApi: jest.fn((url: string) => {
      if (url.includes('/api/graph')) return Promise.resolve(mockGraphResponse);
      if (url.includes('/api/cycles')) return Promise.resolve(mockCyclesResponse);
      if (url.includes('/api/trends')) return Promise.resolve(mockTrendsResponse);
      if (url.includes('/api/file-detail')) return Promise.resolve(mockFileDetailResponse);
      if (url.includes('/api/status')) return Promise.resolve(mockStatusResponse);
      if (url.includes('/api/patterns')) return Promise.resolve(mockPatternsResponse);
      return Promise.resolve(null);
    }),
  };
});

describe('MCP Server - Tool Handlers', () => {
  let tempFilePath: string;
  let tempDir: string;

  beforeEach(() => {
    tempFilePath = path.join('/tmp', `gate-keeper-test-${Date.now()}.ts`);
    tempDir = path.join('/tmp', `gate-keeper-dir-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  // ── analyze_file tests ───────────────────────────────────

  describe('handleAnalyzeFile', () => {
    it('should return error when file_path is missing', async () => {
      const result = await handleAnalyzeFile({});
      expect(result.content[0].text).toContain('Error: file_path is required');
    });

    it('should return error when file does not exist', async () => {
      const result = await handleAnalyzeFile({ file_path: '/nonexistent/file.ts' });
      expect(result.content[0].text).toContain('Error: File not found');
    });

    it('should analyze a valid TypeScript file', async () => {
      fs.writeFileSync(tempFilePath, TEST_CODE_CLEAN);
      const result = await handleAnalyzeFile({ file_path: tempFilePath });
      expect(result.content[0].text).toContain('Rating:');
      expect(result.content[0].text).toContain('Lines of Code:');
    });

    it('should detect violations in code with issues', async () => {
      fs.writeFileSync(tempFilePath, TEST_CODE_WITH_VIOLATIONS);
      const result = await handleAnalyzeFile({ file_path: tempFilePath });
      expect(result.content[0].text).toMatch(/(any|console|Rating)/i);
    });

    it('should return error for unsupported file types', async () => {
      const unsupportedFile = path.join('/tmp', 'test.py');
      fs.writeFileSync(unsupportedFile, 'print("hello")');
      const result = await handleAnalyzeFile({ file_path: unsupportedFile });
      expect(result.content[0].text).toContain('Unsupported file type');
      fs.unlinkSync(unsupportedFile);
    });
  });

  // ── analyze_code tests ───────────────────────────────────

  describe('handleAnalyzeCode', () => {
    it('should return error when code is missing', async () => {
      const result = await handleAnalyzeCode({ language: 'typescript' });
      expect(result.content[0].text).toContain('Error: code is required');
    });

    it('should return error for invalid language', async () => {
      const result = await handleAnalyzeCode({ code: 'test', language: 'python' });
      expect(result.content[0].text).toContain('Error: language must be one of');
    });

    it('should analyze valid TypeScript code', async () => {
      const result = await handleAnalyzeCode({
        code: TEST_CODE_CLEAN,
        language: 'typescript',
      });
      expect(result.content[0].text).toContain('Rating:');
      expect(result.content[0].text).toContain('Lines of Code:');
    });

    it('should analyze valid TSX code', async () => {
      const tsxCode = `
        export const Button = ({ label }: { label: string }) => {
          return <button>{label}</button>;
        };
      `;
      const result = await handleAnalyzeCode({ code: tsxCode, language: 'tsx' });
      expect(result.content[0].text).toContain('Rating:');
    });

    it('should detect any usage violation', async () => {
      const codeWithAny = `function test(x: any): any { return x; }`;
      const result = await handleAnalyzeCode({ code: codeWithAny, language: 'typescript' });
      expect(result.content[0].text).toMatch(/(any|warning|Warning)/i);
    });

    it('should detect console.log violation', async () => {
      const codeWithConsole = `function test() { console.log('debug'); }`;
      const result = await handleAnalyzeCode({ code: codeWithConsole, language: 'typescript' });
      expect(result.content[0].text).toMatch(/(console|info|Info)/i);
    });

    it('should analyze C# code', async () => {
      const csharpCode = `public class Test { public int Add(int a, int b) => a + b; }`;
      const result = await handleAnalyzeCode({ code: csharpCode, language: 'csharp' });
      expect(result.content[0].text).toContain('Rating:');
    });
  });

  // ── get_codebase_health tests ────────────────────────────

  describe('handleCodebaseHealth', () => {
    it('should return error when directory does not exist', async () => {
      const result = await handleCodebaseHealth({ directory: '/nonexistent/dir' });
      expect(result.content[0].text).toContain('Error: Directory not found');
    });

    it('should return health report for valid directory', async () => {
      const testFile = path.join(tempDir, 'test.ts');
      fs.writeFileSync(testFile, TEST_CODE_CLEAN);
      const result = await handleCodebaseHealth({ directory: tempDir, max_files: 10 });
      expect(result.content[0].text).toContain('Codebase Health Report');
      expect(result.content[0].text).toContain('Overall Rating:');
    });

    it('should show rating distribution', async () => {
      const testFile = path.join(tempDir, 'test.ts');
      fs.writeFileSync(testFile, TEST_CODE_CLEAN);
      const result = await handleCodebaseHealth({ directory: tempDir });
      expect(result.content[0].text).toContain('Rating Distribution');
    });

    it('should handle empty directory', async () => {
      const result = await handleCodebaseHealth({ directory: tempDir, max_files: 10 });
      expect(result.content[0].text).toContain('No supported source files');
    });
  });

  // ── get_quality_rules tests ──────────────────────────────

  describe('handleQualityRules', () => {
    it('should return quality rules markdown', async () => {
      const result = await handleQualityRules();
      const textContent = result.content[0].text;
      expect(textContent).toContain('Gate Keeper Quality Rules');
      expect(textContent).toContain('Minimum acceptable rating');
      expect(textContent).toContain('Scoring');
    });

    it('should include TypeScript rules', async () => {
      const result = await handleQualityRules();
      expect(result.content[0].text).toContain('TypeScript');
    });

    it('should include C# rules', async () => {
      const result = await handleQualityRules();
      expect(result.content[0].text).toContain('C#');
    });

    it('should include best practices section', async () => {
      const result = await handleQualityRules();
      expect(result.content[0].text).toContain('Best Practices');
    });

    it('should include test coverage rules', async () => {
      const result = await handleQualityRules();
      expect(result.content[0].text).toContain('Test Coverage');
    });
  });

  // ── get_file_context tests ───────────────────────────────

  describe('handleFileContext', () => {
    it('should return error when file_path is missing', async () => {
      const result = await handleFileContext({});
      expect(result.content[0].text).toContain('Error: file_path is required');
    });

    it('should return file context with dependencies', async () => {
      const result = await handleFileContext({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('File Context:');
      expect(result.content[0].text).toContain('Dependencies');
    });

    it('should show circular dependencies', async () => {
      const result = await handleFileContext({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Circular Dependencies');
    });

    it('should show rating breakdown', async () => {
      const result = await handleFileContext({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Rating Breakdown');
    });

    it('should show rating trend', async () => {
      const result = await handleFileContext({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Rating Trend');
    });

    it('should show git diff', async () => {
      const result = await handleFileContext({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Uncommitted Changes');
    });
  });

  // ── get_dependency_graph tests ───────────────────────────

  describe('handleDependencyGraph', () => {
    it('should return dependency graph', async () => {
      const result = await handleDependencyGraph({});
      expect(result.content[0].text).toContain('Dependency Graph');
      expect(result.content[0].text).toContain('Files:');
      expect(result.content[0].text).toContain('Edges:');
    });

    it('should show rating distribution', async () => {
      const result = await handleDependencyGraph({});
      expect(result.content[0].text).toContain('Rating Distribution');
    });

    it('should show most connected files', async () => {
      const result = await handleDependencyGraph({});
      expect(result.content[0].text).toContain('Most Connected');
    });

    it('should show circular dependencies', async () => {
      const result = await handleDependencyGraph({});
      expect(result.content[0].text).toContain('Circular Dependencies');
    });
  });

  // ── get_impact_analysis tests ────────────────────────────

  describe('handleImpactAnalysis', () => {
    it('should return error when file_path is missing', async () => {
      const result = await handleImpactAnalysis({});
      expect(result.content[0].text).toContain('Error: file_path is required');
    });

    it('should return impact analysis', async () => {
      const result = await handleImpactAnalysis({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Impact Analysis:');
      expect(result.content[0].text).toContain('Direct dependents:');
    });

    it('should show direct dependents', async () => {
      const result = await handleImpactAnalysis({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Direct Dependents');
    });
  });

  // ── suggest_refactoring tests ────────────────────────────

  describe('handleSuggestRefactoring', () => {
    it('should return error when file_path is missing', async () => {
      const result = await handleSuggestRefactoring({});
      expect(result.content[0].text).toContain('Error: file_path is required');
    });

    it('should return error when file does not exist', async () => {
      const result = await handleSuggestRefactoring({ file_path: '/nonexistent.ts' });
      expect(result.content[0].text).toContain('Error: File not found');
    });

    it('should return refactoring suggestions for valid file', async () => {
      fs.writeFileSync(tempFilePath, TEST_CODE_CLEAN);
      const result = await handleSuggestRefactoring({ file_path: tempFilePath });
      expect(result.content[0].text).toMatch(/(Refactoring Suggestions|clean)/i);
    });
  });

  // ── predict_impact_with_remediation tests ────────────────

  describe('handlePredictImpactWithRemediation', () => {
    it('should return error when file_path is missing', async () => {
      const result = await handlePredictImpactWithRemediation({});
      expect(result.content[0].text).toContain('Error: file_path is required');
    });

    it('should return impact with remediation', async () => {
      const result = await handlePredictImpactWithRemediation({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Impact + Remediation:');
    });

    it('should show direct dependents', async () => {
      const result = await handlePredictImpactWithRemediation({ file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Direct Dependents');
    });
  });

  // ── get_violation_patterns tests ─────────────────────────

  describe('handleViolationPatterns', () => {
    it('should return violation patterns', async () => {
      const result = await handleViolationPatterns({});
      expect(result.content[0].text).toMatch(/(Violation Patterns|Rank|Pattern)/i);
    });

    it('should show pattern table', async () => {
      const result = await handleViolationPatterns({});
      expect(result.content[0].text).toContain('| Rank |');
    });
  });

  // ── handleToolCall router tests ──────────────────────────

  describe('handleToolCall', () => {
    it('should return error for unknown tool', async () => {
      const result = await handleToolCall('unknown_tool', {});
      expect(result.content[0].text).toContain('Unknown tool');
    });

    it('should route to analyze_file', async () => {
      fs.writeFileSync(tempFilePath, TEST_CODE_CLEAN);
      const result = await handleToolCall('analyze_file', { file_path: tempFilePath });
      expect(result.content[0].text).toContain('Rating:');
    });

    it('should route to analyze_code', async () => {
      const result = await handleToolCall('analyze_code', {
        code: TEST_CODE_CLEAN,
        language: 'typescript',
      });
      expect(result.content[0].text).toContain('Rating:');
    });

    it('should route to get_quality_rules', async () => {
      const result = await handleToolCall('get_quality_rules', {});
      expect(result.content[0].text).toContain('Quality Rules');
    });

    it('should route to get_codebase_health', async () => {
      const testFile = path.join(tempDir, 'test.ts');
      fs.writeFileSync(testFile, TEST_CODE_CLEAN);
      const result = await handleToolCall('get_codebase_health', { directory: tempDir });
      expect(result.content[0].text).toContain('Codebase Health');
    });

    it('should route to get_file_context', async () => {
      const result = await handleToolCall('get_file_context', { file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('File Context');
    });

    it('should route to get_dependency_graph', async () => {
      const result = await handleToolCall('get_dependency_graph', {});
      expect(result.content[0].text).toContain('Dependency Graph');
    });

    it('should route to get_impact_analysis', async () => {
      const result = await handleToolCall('get_impact_analysis', { file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Impact Analysis');
    });

    it('should route to suggest_refactoring', async () => {
      fs.writeFileSync(tempFilePath, TEST_CODE_CLEAN);
      const result = await handleToolCall('suggest_refactoring', { file_path: tempFilePath });
      expect(result.content[0].text).toMatch(/(Refactoring|clean)/i);
    });

    it('should route to predict_impact_with_remediation', async () => {
      const result = await handleToolCall('predict_impact_with_remediation', { file_path: '/test/file.ts' });
      expect(result.content[0].text).toContain('Impact');
    });

    it('should route to get_violation_patterns', async () => {
      const result = await handleToolCall('get_violation_patterns', {});
      expect(result.content[0].text).toMatch(/(Violation Patterns|Rank)/i);
    });
  });

  // ── Helper function tests ────────────────────────────────

  describe('text helper', () => {
    it('should wrap content in proper response format', () => {
      const result = text('Hello World');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('Hello World');
    });
  });

  describe('getMinRating', () => {
    it('should return a valid rating number', () => {
      const rating = getMinRating();
      expect(typeof rating).toBe('number');
    });

    it('should return rating between 0 and 10', () => {
      const rating = getMinRating();
      expect(rating).toBeGreaterThanOrEqual(0);
      expect(rating).toBeLessThanOrEqual(10);
    });
  });

  describe('findGitRoot', () => {
    it('should return a valid path', () => {
      const gitRoot = findGitRoot(process.cwd());
      expect(typeof gitRoot).toBe('string');
      expect(gitRoot.length).toBeGreaterThan(0);
    });

    it('should return existing directory', () => {
      const gitRoot = findGitRoot(process.cwd());
      expect(fs.existsSync(gitRoot)).toBe(true);
    });
  });

  describe('findSourceFiles', () => {
    it('should find supported files', () => {
      const testFile = path.join(tempDir, 'test.ts');
      fs.writeFileSync(testFile, TEST_CODE_CLEAN);
      const files = findSourceFiles(tempDir, 10);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toContain('test.ts');
    });

    it('should respect maxFiles limit', () => {
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(tempDir, `test${i}.ts`), TEST_CODE_CLEAN);
      }
      const files = findSourceFiles(tempDir, 2);
      expect(files.length).toBe(2);
    });

    it('should skip node_modules', () => {
      const nodeModulesDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(nodeModulesDir, { recursive: true });
      fs.writeFileSync(path.join(nodeModulesDir, 'test.ts'), TEST_CODE_CLEAN);
      const files = findSourceFiles(tempDir, 10);
      expect(files.length).toBe(0);
    });
  });

  describe('formatAnalysisResult', () => {
    const mockAnalysis = {
      path: '/test/file.ts',
      language: 'typescript' as const,
      rating: 7.5,
      violations: [
        { type: 'any_usage', severity: 'warning' as const, message: 'Avoid using any type', line: 5, fix: 'Use specific type' },
      ],
      metrics: {
        linesOfCode: 50,
        cyclomaticComplexity: 5,
        numberOfMethods: 3,
        numberOfClasses: 1,
        importCount: 2,
        coveragePercent: 75,
      },
      dependencies: [],
      analyzedAt: Date.now(),
    };

    it('should format analysis with violations', () => {
      const result = formatAnalysisResult(mockAnalysis, 7.0);
      expect(result).toContain('file.ts');
      expect(result).toContain('Rating: 7.5');
      expect(result).toContain('any_usage');
    });

    it('should show PASSED when rating meets threshold', () => {
      const result = formatAnalysisResult(mockAnalysis, 7.0);
      expect(result).toContain('PASSED');
    });

    it('should show NEEDS IMPROVEMENT when rating below threshold', () => {
      const result = formatAnalysisResult(mockAnalysis, 8.0);
      expect(result).toContain('NEEDS IMPROVEMENT');
    });

    it('should include metrics section', () => {
      const result = formatAnalysisResult(mockAnalysis, 7.0);
      expect(result).toContain('Lines of Code:');
      expect(result).toContain('Cyclomatic Complexity:');
    });

    it('should include coverage when available', () => {
      const result = formatAnalysisResult(mockAnalysis, 7.0);
      expect(result).toContain('Test Coverage:');
    });

    it('should show action required when failed', () => {
      const result = formatAnalysisResult(mockAnalysis, 8.0);
      expect(result).toContain('Action Required');
    });
  });

  describe('formatStringResult', () => {
    const mockStringResult = {
      language: 'typescript' as const,
      rating: 8.0,
      violations: [],
      metrics: {
        linesOfCode: 1,
        cyclomaticComplexity: 1,
        numberOfMethods: 1,
        numberOfClasses: 0,
        importCount: 0,
      },
      dependencies: [],
    };

    it('should format string analysis result', () => {
      const result = formatStringResult(mockStringResult, 7.0);
      expect(result).toContain('Rating: 8');
      expect(result).toContain('PASSED');
    });

    it('should include metrics', () => {
      const result = formatStringResult(mockStringResult, 7.0);
      expect(result).toContain('Lines of Code:');
      expect(result).toContain('Complexity:');
    });

    it('should show action required when failed', () => {
      const failedResult = { ...mockStringResult, rating: 5.0 };
      const result = formatStringResult(failedResult, 7.0);
      expect(result).toContain('Action Required');
    });
  });
});
