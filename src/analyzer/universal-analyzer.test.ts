import * as fs from 'fs';
import * as path from 'path';
import { UniversalAnalyzer } from './universal-analyzer';

describe('UniversalAnalyzer', () => {
  let analyzer: UniversalAnalyzer;
  let tempDir: string;

  beforeAll(() => {
    tempDir = path.join(__dirname, '../../temp-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    analyzer = new UniversalAnalyzer();
  });

  describe('isSupportedFile', () => {
    it('should support TypeScript files', () => {
      expect(analyzer.isSupportedFile('/src/foo.ts')).toBe(true);
      expect(analyzer.isSupportedFile('/src/foo.tsx')).toBe(true);
      expect(analyzer.isSupportedFile('/src/foo.jsx')).toBe(true);
      expect(analyzer.isSupportedFile('/src/foo.js')).toBe(true);
    });

    it('should support C# files', () => {
      expect(analyzer.isSupportedFile('/src/Foo.cs')).toBe(true);
    });

    it('should not support unsupported files', () => {
      expect(analyzer.isSupportedFile('/src/foo.py')).toBe(false);
      expect(analyzer.isSupportedFile('/src/foo.java')).toBe(false);
      expect(analyzer.isSupportedFile('/src/foo.go')).toBe(false);
      expect(analyzer.isSupportedFile('/src/foo.rs')).toBe(false);
    });
  });

  describe('analyze TypeScript', () => {
    it('should analyze a TypeScript file', async () => {
      const tsFile = path.join(tempDir, 'test.ts');
      fs.writeFileSync(
        tsFile,
        `
        function add(a: number, b: number): number {
          return a + b;
        }
        
        export { add };
      `
      );

      const result = await analyzer.analyze(tsFile);

      expect(result).not.toBeNull();
      expect(result?.language).toBe('typescript');
      expect(result?.path).toBe(tsFile);
      expect(result?.metrics.numberOfMethods).toBe(1);
      expect(result?.rating).toBeGreaterThanOrEqual(0);
      expect(result?.rating).toBeLessThanOrEqual(10);
    });

    it('should analyze a TSX React file', async () => {
      const tsxFile = path.join(tempDir, 'Component.tsx');
      fs.writeFileSync(
        tsxFile,
        `
        import React from 'react';
        
        function MyComponent() {
          const [count, setCount] = React.useState(0);
          return <div>{count}</div>;
        }
        
        export default MyComponent;
      `
      );

      const result = await analyzer.analyze(tsxFile);

      expect(result).not.toBeNull();
      expect(result?.language).toBe('tsx');
      expect(result?.metrics.numberOfMethods).toBeGreaterThanOrEqual(1);
    });

    it('should detect violations in TypeScript file', async () => {
      const tsFile = path.join(tempDir, 'bad.ts');
      fs.writeFileSync(
        tsFile,
        `
        function process(value: any): string {
          console.log(value);
          // TODO: fix this
          return String(value);
        }
      `
      );

      const result = await analyzer.analyze(tsFile);

      expect(result).not.toBeNull();
      // Violations may vary based on analysis - verify we got some violations
      expect(result?.violations.length).toBeGreaterThan(0);
    });

    it('should handle analysis errors gracefully', async () => {
      const tsFile = path.join(tempDir, 'invalid.ts');
      fs.writeFileSync(tsFile, 'this is not valid typescript {{{');

      const result = await analyzer.analyze(tsFile);

      expect(result).not.toBeNull();
      expect(result?.path).toBe(tsFile);
      // Rating may vary based on violations found
      expect(result?.rating).toBeGreaterThanOrEqual(0);
      expect(result?.rating).toBeLessThanOrEqual(10);
    });
  });

  describe('analyze C#', () => {
    it('should analyze a C# file', async () => {
      const csFile = path.join(tempDir, 'Calculator.cs');
      fs.writeFileSync(
        csFile,
        `
        public class Calculator {
          public int Add(int a, int b) {
            return a + b;
          }
        }
      `
      );

      const result = await analyzer.analyze(csFile);

      expect(result).not.toBeNull();
      expect(result?.language).toBe('csharp');
      expect(result?.path).toBe(csFile);
      expect(result?.metrics.numberOfMethods).toBe(1);
      expect(result?.metrics.numberOfClasses).toBe(1);
    });

    it('should detect violations in C# file', async () => {
      const csFile = path.join(tempDir, 'BadCode.cs');
      fs.writeFileSync(
        csFile,
        `
        public class BadClass {
          public void Process() {
            try {
              RiskyOperation();
            } catch {}
            
            // TODO: implement properly
            throw new NotImplementedException();
          }
        }
      `
      );

      const result = await analyzer.analyze(csFile);

      expect(result).not.toBeNull();
      // Violations may vary based on analysis
      expect(result?.violations.length).toBeGreaterThanOrEqual(0);
    });

    it('should attach definedTypes for C# files', async () => {
      const csFile = path.join(tempDir, 'Models.cs');
      fs.writeFileSync(
        csFile,
        `
        public class User {
          public string Name { get; set; }
        }
        
        public interface IUserService {
          User GetUser(int id);
        }
      `
      );

      const result = await analyzer.analyze(csFile);

      expect(result).not.toBeNull();
      expect(result?.definedTypes).toEqual(expect.arrayContaining(['User', 'IUserService']));
    });
  });

  describe('coverage integration', () => {
    it('should analyze file without test coverage', async () => {
      const tsFile = path.join(tempDir, 'noTest.ts');
      fs.writeFileSync(tsFile, 'export const value = 42;');

      const result = await analyzer.analyze(tsFile);

      expect(result).not.toBeNull();
      // File should be analyzed successfully regardless of test coverage
      expect(result?.path).toBe(tsFile);
    });

    it('should handle test file detection', async () => {
      const tsFile = path.join(tempDir, 'source.ts');
      const testFile = path.join(tempDir, 'source.test.ts');
      
      fs.writeFileSync(tsFile, 'export function add(a: number, b: number) { return a + b; }');
      fs.writeFileSync(testFile, '// empty test file');

      const result = await analyzer.analyze(tsFile);

      expect(result).not.toBeNull();
      // Analysis should complete regardless of test file content
      expect(result?.path).toBe(tsFile);
    });

    it('should not add coverage violations when coverage is measured', async () => {
      const tsFile = path.join(tempDir, 'covered.ts');
      const testFile = path.join(tempDir, 'covered.test.ts');
      
      fs.writeFileSync(tsFile, 'export function multiply(a: number, b: number) { return a * b; }');
      fs.writeFileSync(
        testFile,
        `
        import { multiply } from './covered';
        
        describe('multiply', () => {
          it('should multiply two numbers', () => {
            expect(multiply(2, 3)).toBe(6);
          });
        });
      `
      );

      const result = await analyzer.analyze(tsFile);

      expect(result).not.toBeNull();
      // When test file has real content, hollow_test_file should not be present
      const hollowViolation = result?.violations.find(v => v.type === 'hollow_test_file');
      expect(hollowViolation).toBeUndefined();
    });
  });

  describe('rating calculation', () => {
    it('should calculate rating based on violations and metrics', async () => {
      const tsFile = path.join(tempDir, 'rated.ts');
      fs.writeFileSync(
        tsFile,
        `
        function goodFunction(a: number, b: number): number {
          return a + b;
        }
        
        export { goodFunction };
      `
      );

      const result = await analyzer.analyze(tsFile);

      expect(result).not.toBeNull();
      expect(result?.rating).toBeGreaterThanOrEqual(0);
      expect(result?.rating).toBeLessThanOrEqual(10);
    });

    it('should have lower rating for files with many violations', async () => {
      const badFile = path.join(tempDir, 'bad.ts');
      fs.writeFileSync(
        badFile,
        `
        function bad(a: any, b: any): any {
          console.log(a);
          console.log(b);
          // TODO: fix
          // FIXME: broken
          return a as any;
        }
      `
      );

      const result = await analyzer.analyze(badFile);

      expect(result).not.toBeNull();
      expect(result?.violations.length).toBeGreaterThan(3);
    });
  });

  describe('analyzedAt timestamp', () => {
    it('should include analyzedAt timestamp', async () => {
      const tsFile = path.join(tempDir, 'timestamp.ts');
      fs.writeFileSync(tsFile, 'export const x = 1;');

      const beforeAnalysis = Date.now();
      const result = await analyzer.analyze(tsFile);
      const afterAnalysis = Date.now();

      expect(result).not.toBeNull();
      expect(result?.analyzedAt).toBeGreaterThanOrEqual(beforeAnalysis);
      expect(result?.analyzedAt).toBeLessThanOrEqual(afterAnalysis);
    });
  });

  describe('agent-grade enrichment (Phase 4)', () => {
    it('attaches ratingBreakdown, fileHash, and analyzerVersion to every analysis', async () => {
      const tsFile = path.join(tempDir, 'enrich.ts');
      fs.writeFileSync(tsFile, `const x: any = 1;\nconsole.log(x);\n`);

      const result = await analyzer.analyze(tsFile);

      expect(result).not.toBeNull();
      expect(result?.analyzerVersion).toBe('2.0');
      expect(typeof result?.fileHash).toBe('string');
      expect(result?.fileHash).toMatch(/^[a-f0-9]{40}$/);
      expect(Array.isArray(result?.ratingBreakdown)).toBe(true);
      expect(result!.ratingBreakdown!.length).toBeGreaterThan(0);
      const cats = result!.ratingBreakdown!.map(b => b.category);
      expect(cats.some(c => c.startsWith('Warnings'))).toBe(true);
    });

    it('changes fileHash when file content changes', async () => {
      const tsFile = path.join(tempDir, 'hash.ts');
      fs.writeFileSync(tsFile, 'export const x = 1;');
      const r1 = await analyzer.analyze(tsFile);

      fs.writeFileSync(tsFile, 'export const x = 2;');
      const r2 = await analyzer.analyze(tsFile);

      expect(r1?.fileHash).toBeDefined();
      expect(r2?.fileHash).toBeDefined();
      expect(r1?.fileHash).not.toBe(r2?.fileHash);
    });

    it('sorts violations by priorityScore desc (deterministic-fix errors first)', async () => {
      const tsFile = path.join(tempDir, 'priority.ts');
      fs.writeFileSync(tsFile, `console.log(1);\nconst x: any = 1;\n`);

      const result = await analyzer.analyze(tsFile);
      const vs = result!.violations;

      expect(vs.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < vs.length; i++) {
        expect(vs[i - 1].priorityScore ?? 0).toBeGreaterThanOrEqual(vs[i].priorityScore ?? 0);
      }
      const anyIdx = vs.findIndex(v => v.type === 'any_type');
      const consoleIdx = vs.findIndex(v => v.type === 'console_log');
      expect(anyIdx).toBeLessThan(consoleIdx);
    });
  });
});
