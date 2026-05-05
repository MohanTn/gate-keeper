import { StringAnalyzer } from './string-analyzer';

describe('StringAnalyzer', () => {
  let analyzer: StringAnalyzer;

  beforeEach(() => {
    analyzer = new StringAnalyzer();
  });

  describe('analyze TypeScript', () => {
    it('should analyze simple TypeScript code', () => {
      const code = `
        function add(a: number, b: number): number {
          return a + b;
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      expect(result.language).toBe('typescript');
      expect(result.metrics.numberOfMethods).toBe(1);
      expect(result.violations.length).toBeGreaterThanOrEqual(0);
      expect(result.rating).toBeGreaterThanOrEqual(0);
      expect(result.rating).toBeLessThanOrEqual(10);
    });

    it('should detect any type usage', () => {
      const code = `
        function process(value: any): string {
          return String(value);
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      const anyViolation = result.violations.find(v => v.type === 'any_usage');
      expect(anyViolation).toBeDefined();
      expect(anyViolation?.severity).toBe('warning');
    });

    it('should detect console.log statements', () => {
      const code = `
        function logMessage(msg: string) {
          console.log(msg);
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      const consoleViolation = result.violations.find(v => v.type === 'console_log');
      expect(consoleViolation).toBeDefined();
    });

    it('should extract import dependencies', () => {
      const code = `
        import { useState } from 'react';
        import { helper } from './utils';
        
        export function Component() {
          return null;
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      expect(result.dependencies.length).toBe(2);
      expect(result.dependencies.map(d => d.target)).toContain('react');
      expect(result.dependencies.map(d => d.target)).toContain('./utils');
    });
  });

  describe('analyze React/TSX', () => {
    it('should detect missing key prop in map', () => {
      const code = `
        function List({ items }) {
          return (
            <div>
              {items.map(item => (
                <span>{item.name}</span>
              ))}
            </div>
          );
        }
      `;

      const result = analyzer.analyze(code, 'tsx');

      const missingKeyViolation = result.violations.find(v => v.type === 'missing_key');
      expect(missingKeyViolation).toBeDefined();
      expect(missingKeyViolation?.severity).toBe('error');
    });

    it('should not flag map with key prop', () => {
      const code = `
        function List({ items }) {
          return (
            <div>
              {items.map(item => (
                <span key={item.id}>{item.name}</span>
              ))}
            </div>
          );
        }
      `;

      const result = analyzer.analyze(code, 'tsx');

      const missingKeyViolation = result.violations.find(v => v.type === 'missing_key');
      expect(missingKeyViolation).toBeUndefined();
    });

    it('should detect React hooks usage', () => {
      const code = `
        function Counter() {
          const [count, setCount] = useState(0);
          useEffect(() => {}, []);
          return <div>{count}</div>;
        }
      `;

      const result = analyzer.analyze(code, 'tsx');

      expect(result.language).toBe('tsx');
      expect(result.metrics.numberOfMethods).toBeGreaterThanOrEqual(1);
    });
  });

  describe('analyze C#', () => {
    it('should analyze simple C# code', () => {
      const code = `
        public class Calculator {
          public int Add(int a, int b) {
            return a + b;
          }
        }
      `;

      const result = analyzer.analyze(code, 'csharp');

      expect(result.language).toBe('csharp');
      expect(result.metrics.numberOfMethods).toBe(1);
      expect(result.metrics.numberOfClasses).toBe(1);
      expect(result.rating).toBeGreaterThanOrEqual(0);
      expect(result.rating).toBeLessThanOrEqual(10);
    });

    it('should detect constructors with too many parameters', () => {
      const code = `
        public class UserService {
          public UserService(IDbConnection db, ICache cache, ILogger logger, IEmailService email, ISmsService sms, INotificationService notifications, IAuditService audit) {}
        }
      `;

      const result = analyzer.analyze(code, 'csharp');

      const tightCouplingViolation = result.violations.find(v => v.type === 'tight_coupling');
      expect(tightCouplingViolation).toBeDefined();
      expect(tightCouplingViolation?.message).toContain('parameters');
    });

    it('should detect long methods', () => {
      const lines = [
        'public void ProcessData() {',
        ...Array(55).fill('  // doing something'),
        '}'
      ];
      const code = lines.join('\n');

      const result = analyzer.analyze(code, 'csharp');

      const longMethodViolation = result.violations.find(v => v.type === 'long_method');
      expect(longMethodViolation).toBeDefined();
      expect(longMethodViolation?.message).toContain('lines');
    });

    it('should detect empty catch blocks', () => {
      const code = `
        public void DoWork() {
          try {
            RiskyOperation();
          } catch {}
        }
      `;

      const result = analyzer.analyze(code, 'csharp');

      const emptyCatchViolation = result.violations.find(v => v.type === 'empty_catch');
      expect(emptyCatchViolation).toBeDefined();
      expect(emptyCatchViolation?.severity).toBe('error');
    });

    it('should detect god class with too many methods', () => {
      const methods = Array(25).fill(0).map((_, i) => 
        `public void Method${i}() { }`
      ).join('\n');
      
      const code = `public class GodClass { ${methods} }`;

      const result = analyzer.analyze(code, 'csharp');

      const godClassViolation = result.violations.find(v => v.type === 'god_class');
      expect(godClassViolation).toBeDefined();
      expect(godClassViolation?.message).toContain('methods');
    });
  });

  describe('TODO and placeholder detection', () => {
    it('should detect TODO markers', () => {
      const code = `
        function process() {
          // TODO: implement this
          return null;
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      const todoViolation = result.violations.find(v => v.type === 'todo_placeholder');
      expect(todoViolation).toBeDefined();
      expect(todoViolation?.message).toContain('TODO');
    });

    it('should detect FIXME markers', () => {
      const code = `
        function process() {
          /* FIXME: this is broken */
          return null;
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      const fixmeViolation = result.violations.find(v => v.type === 'todo_placeholder');
      expect(fixmeViolation).toBeDefined();
      expect(fixmeViolation?.message).toContain('FIXME');
    });

    it('should detect HACK markers as tech debt', () => {
      const code = `
        function process() {
          // HACK: temporary workaround
          return null;
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      const hackViolation = result.violations.find(v => v.type === 'tech_debt_marker');
      expect(hackViolation).toBeDefined();
      expect(hackViolation?.message).toContain('HACK');
    });

    it('should detect unimplemented stubs in TypeScript', () => {
      const code = `
        function notImplemented() {
          throw new Error('Not implemented');
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      const stubViolation = result.violations.find(v => v.type === 'unimplemented_stub');
      expect(stubViolation).toBeDefined();
      expect(stubViolation?.severity).toBe('error');
    });

    it('should detect NotImplementedException in C#', () => {
      const code = `
        public void Process() {
          throw new NotImplementedException();
        }
      `;

      const result = analyzer.analyze(code, 'csharp');

      const stubViolation = result.violations.find(v => v.type === 'unimplemented_stub');
      expect(stubViolation).toBeDefined();
    });
  });

  describe('metrics calculation', () => {
    it('should calculate lines of code', () => {
      const code = `
        line 1
        line 2
        line 3
        line 4
        line 5
      `;

      const result = analyzer.analyze(code, 'typescript');

      expect(result.metrics.linesOfCode).toBeGreaterThanOrEqual(5);
    });

    it('should calculate cyclomatic complexity', () => {
      const code = `
        function process(x: number) {
          if (x > 0) {
            if (x > 10) {
              return 'big';
            }
            return 'small';
          }
          return 'negative';
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      expect(result.metrics.cyclomaticComplexity).toBeGreaterThan(1);
    });

    it('should count classes and methods', () => {
      const code = `
        class Foo {
          method1() {}
          method2() {}
        }
        class Bar {
          method3() {}
        }
      `;

      const result = analyzer.analyze(code, 'typescript');

      expect(result.metrics.numberOfClasses).toBe(2);
      expect(result.metrics.numberOfMethods).toBe(3);
    });
  });
});
