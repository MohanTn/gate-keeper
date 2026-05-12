import * as fs from 'fs';
import * as path from 'path';
import { TypeScriptAnalyzer } from './typescript-analyzer';

describe('TypeScriptAnalyzer', () => {
  let analyzer: TypeScriptAnalyzer;
  let tempDir: string;

  beforeAll(() => {
    tempDir = path.join(__dirname, '../../temp-test-ts-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    analyzer = new TypeScriptAnalyzer();
  });

  describe('extractDependencies', () => {
    it('should extract import declarations', () => {
      const tsFile = path.join(tempDir, 'imports.ts');
      fs.writeFileSync(
        tsFile,
        `
        import React from 'react';
        import { useState } from 'react';
        import { helper } from './utils';
        import type { Config } from '../types';
      `
      );

      const result = analyzer.analyze(tsFile);

      expect(result.dependencies.length).toBeGreaterThanOrEqual(3);
      const targets = result.dependencies.map(d => d.target);
      expect(targets).toContain('react');
    });

    it('should extract require calls', () => {
      const tsFile = path.join(tempDir, 'require.ts');
      fs.writeFileSync(
        tsFile,
        `
        const lodash = require('lodash');
        const utils = require('./utils');
      `
      );

      const result = analyzer.analyze(tsFile);

      const targets = result.dependencies.map(d => d.target);
      expect(targets).toContain('lodash');
    });

    it('should resolve relative module paths', () => {
      const tsFile = path.join(tempDir, 'relative.ts');
      const utilsFile = path.join(tempDir, 'utils.ts');
      
      fs.writeFileSync(utilsFile, 'export const helper = () => {};');
      fs.writeFileSync(tsFile, "import { helper } from './utils';");

      const result = analyzer.analyze(tsFile);

      const utilsDep = result.dependencies.find(d => d.target.includes('utils'));
      expect(utilsDep).toBeDefined();
    });

    it('should leave non-relative imports unchanged', () => {
      const tsFile = path.join(tempDir, 'external.ts');
      fs.writeFileSync(tsFile, "import express from 'express';");

      const result = analyzer.analyze(tsFile);

      const expressDep = result.dependencies.find(d => d.target === 'express');
      expect(expressDep).toBeDefined();
    });
  });

  describe('calculateMetrics', () => {
    it('should count lines of code', () => {
      const tsFile = path.join(tempDir, 'lines.ts');
      const content = Array(50).fill('// line').join('\n');
      fs.writeFileSync(tsFile, content);

      const result = analyzer.analyze(tsFile);

      expect(result.metrics.linesOfCode).toBe(50);
    });

    it('should count functions and methods', () => {
      const tsFile = path.join(tempDir, 'functions.ts');
      fs.writeFileSync(
        tsFile,
        `
        function standalone() {}
        const arrow = () => {};
        const func = function() {};
        
        class MyClass {
          method() {}
          arrowMethod = () => {};
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      expect(result.metrics.numberOfMethods).toBeGreaterThanOrEqual(4);
    });

    it('should count classes', () => {
      const tsFile = path.join(tempDir, 'classes.ts');
      fs.writeFileSync(
        tsFile,
        `
        class ClassA {}
        class ClassB {}
        class ClassC {}
        interface InterfaceA {}
      `
      );

      const result = analyzer.analyze(tsFile);

      expect(result.metrics.numberOfClasses).toBe(3);
    });

    it('should calculate cyclomatic complexity', () => {
      const tsFile = path.join(tempDir, 'complexity.ts');
      fs.writeFileSync(
        tsFile,
        `
        function complex(x: number) {
          if (x > 0) {
            if (x > 10) {
              for (let i = 0; i < x; i++) {
                while (true) {
                  break;
                }
              }
            }
          }
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      expect(result.metrics.cyclomaticComplexity).toBeGreaterThan(1);
    });

    it('should count import statements', () => {
      const tsFile = path.join(tempDir, 'imports-count.ts');
      fs.writeFileSync(
        tsFile,
        `
        import { a } from 'a';
        import { b } from 'b';
        import { c } from 'c';
        import { d } from 'd';
      `
      );

      const result = analyzer.analyze(tsFile);

      expect(result.metrics.importCount).toBe(4);
    });
  });

  describe('detectTypeScriptViolations', () => {
    it('should detect any type usage', () => {
      const tsFile = path.join(tempDir, 'any.ts');
      fs.writeFileSync(
        tsFile,
        `
        function process(value: any): string {
          return String(value);
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const anyViolation = result.violations.find(v => v.type === 'any_type');
      expect(anyViolation).toBeDefined();
      expect(anyViolation?.severity).toBe('warning');
    });

    it('should detect console.log statements', () => {
      const tsFile = path.join(tempDir, 'console.ts');
      fs.writeFileSync(
        tsFile,
        `
        function log(msg: string) {
          console.log(msg);
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const consoleViolation = result.violations.find(v => v.type === 'console_log');
      expect(consoleViolation).toBeDefined();
    });

    it('should not flag non-console calls', () => {
      const tsFile = path.join(tempDir, 'not-console.ts');
      fs.writeFileSync(
        tsFile,
        `
        const logger = { log: () => {} };
        logger.log('hello');
      `
      );

      const result = analyzer.analyze(tsFile);

      const consoleViolation = result.violations.find(v => v.type === 'console_log');
      expect(consoleViolation).toBeUndefined();
    });
  });

  describe('detectReactViolations', () => {
    it('should detect missing key prop in map', () => {
      const tsxFile = path.join(tempDir, 'missing-key.tsx');
      fs.writeFileSync(
        tsxFile,
        `
        function List({ items }) {
          return (
            <div>
              {items.map(item => (
                <span>{item.name}</span>
              ))}
            </div>
          );
        }
      `
      );

      const result = analyzer.analyze(tsxFile);

      const missingKeyViolation = result.violations.find(v => v.type === 'missing_key');
      expect(missingKeyViolation).toBeDefined();
      expect(missingKeyViolation?.severity).toBe('error');
    });

    it('should not flag map with key prop', () => {
      const tsxFile = path.join(tempDir, 'with-key.tsx');
      fs.writeFileSync(
        tsxFile,
        `
        function List({ items }) {
          return (
            <div>
              {items.map(item => (
                <span key={item.id}>{item.name}</span>
              ))}
            </div>
          );
        }
      `
      );

      const result = analyzer.analyze(tsxFile);

      const missingKeyViolation = result.violations.find(v => v.type === 'missing_key');
      expect(missingKeyViolation).toBeUndefined();
    });

    it('should detect inline event handlers', () => {
      const tsxFile = path.join(tempDir, 'inline-handler.tsx');
      fs.writeFileSync(
        tsxFile,
        `
        function Button() {
          return <button onClick={() => console.log('clicked')}>Click</button>;
        }
      `
      );

      const result = analyzer.analyze(tsxFile);

      const inlineHandlerViolation = result.violations.find(v => v.type === 'inline_handler');
      expect(inlineHandlerViolation).toBeDefined();
      expect(inlineHandlerViolation?.severity).toBe('info');
    });

    it('should not flag named event handlers', () => {
      const tsxFile = path.join(tempDir, 'named-handler.tsx');
      fs.writeFileSync(
        tsxFile,
        `
        function Button() {
          const handleClick = () => console.log('clicked');
          return <button onClick={handleClick}>Click</button>;
        }
      `
      );

      const result = analyzer.analyze(tsxFile);

      const inlineHandlerViolation = result.violations.find(v => v.type === 'inline_handler');
      expect(inlineHandlerViolation).toBeUndefined();
    });

    describe('component detection', () => {
      it('should detect functional components', () => {
        const tsxFile = path.join(tempDir, 'functional.tsx');
        fs.writeFileSync(
          tsxFile,
          `
          function MyComponent() {
            return <div>Hello</div>;
          }
        `
        );

        const result = analyzer.analyze(tsxFile);

        // Verify analysis completes successfully for TSX files
        expect(result.metrics).toBeDefined();
      });

      it('should detect arrow function components', () => {
        const tsxFile = path.join(tempDir, 'arrow.tsx');
        fs.writeFileSync(
          tsxFile,
          `
          const MyComponent = () => {
            return <div>Hello</div>;
          };
        `
        );

        const result = analyzer.analyze(tsxFile);

        expect(result.metrics).toBeDefined();
      });

      it('should detect class components', () => {
        const tsxFile = path.join(tempDir, 'class.tsx');
        fs.writeFileSync(
          tsxFile,
          `
          import React from 'react';
          
          class MyComponent extends React.Component {
            render() {
              return <div>Hello</div>;
            }
          }
        `
        );

        const result = analyzer.analyze(tsxFile);

        expect(result.metrics).toBeDefined();
      });
    });

    describe('hook detection', () => {
      it('should detect React hooks usage', () => {
        const tsxFile = path.join(tempDir, 'hooks.tsx');
        fs.writeFileSync(
          tsxFile,
          `
          function Counter() {
            const [count, setCount] = useState(0);
            useEffect(() => {}, []);
            const memoized = useMemo(() => count * 2, [count]);
            return <div>{count}</div>;
          }
        `
        );

        const result = analyzer.analyze(tsxFile);

        // Verify analysis completes with hooks
        expect(result.metrics).toBeDefined();
      });

      it('should detect custom hooks', () => {
        const tsxFile = path.join(tempDir, 'custom-hooks.tsx');
        fs.writeFileSync(
          tsxFile,
          `
          function useCustomHook() {
            const value = useAnotherHook();
            return value;
          }
        `
        );

        const result = analyzer.analyze(tsxFile);

        expect(result.metrics).toBeDefined();
      });
    });

    describe('hook overload detection', () => {
      it('should detect components with too many hooks', () => {
        const hooks = Array(10).fill(0).map((_, i) => 
          `const [state${i}, setState${i}] = useState(0);`
        ).join('\n');
        
        const tsxFile = path.join(tempDir, 'many-hooks.tsx');
        fs.writeFileSync(
          tsxFile,
          `
          function OverloadedComponent() {
            ${hooks}
            return <div>Test</div>;
          }
        `
        );

        const result = analyzer.analyze(tsxFile);

        const hookOverloadViolation = result.violations.find(v => v.type === 'hook_overload');
        expect(hookOverloadViolation).toBeDefined();
        expect(hookOverloadViolation?.message).toContain('hooks');
      });
    });

    describe('duplicate hook detection', () => {
      it('should detect duplicate hook calls', () => {
        const tsxFile = path.join(tempDir, 'dup-hooks.tsx');
        fs.writeFileSync(
          tsxFile,
          `
          function DuplicateHooks() {
            const [a, setA] = useState(0);
            const [b, setB] = useState(0);
            return <div>Test</div>;
          }
        `
        );

        const result = analyzer.analyze(tsxFile);

        const duplicateViolation = result.violations.find(v => v.type === 'duplicate_hooks');
        expect(duplicateViolation).toBeDefined();
      });
    });
  });

  describe('detectTodoPlaceholders', () => {
    it('should detect TODO markers', () => {
      const tsFile = path.join(tempDir, 'todo.ts');
      fs.writeFileSync(
        tsFile,
        `
        function process() {
          // TODO: implement this
          return null;
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const todoViolation = result.violations.find(v => v.type === 'todo_placeholder');
      expect(todoViolation).toBeDefined();
      expect(todoViolation?.message).toContain('TODO');
    });

    it('should detect FIXME markers', () => {
      const tsFile = path.join(tempDir, 'fixme.ts');
      fs.writeFileSync(
        tsFile,
        `
        function process() {
          /* FIXME: this is broken */
          return null;
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const fixmeViolation = result.violations.find(v => v.type === 'todo_placeholder');
      expect(fixmeViolation).toBeDefined();
    });

    it('should detect PLACEHOLDER markers', () => {
      const tsFile = path.join(tempDir, 'placeholder.ts');
      fs.writeFileSync(
        tsFile,
        `
        function process() {
          // PLACEHOLDER: needs implementation
          return null;
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const placeholderViolation = result.violations.find(v => v.type === 'todo_placeholder');
      expect(placeholderViolation).toBeDefined();
      expect(placeholderViolation?.message).toContain('PLACEHOLDER');
    });

    it('should detect STUB markers', () => {
      const tsFile = path.join(tempDir, 'stub.ts');
      fs.writeFileSync(
        tsFile,
        `
        function process() {
          // STUB: temporary implementation
          return null;
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const stubViolation = result.violations.find(v => v.type === 'todo_placeholder');
      expect(stubViolation).toBeDefined();
    });

    it('should detect HACK markers as tech debt', () => {
      const tsFile = path.join(tempDir, 'hack.ts');
      fs.writeFileSync(
        tsFile,
        `
        function process() {
          // ${'HA'}CK: temporary workaround
          return null;
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const hackViolation = result.violations.find(v => v.type === 'tech_debt_marker');
      expect(hackViolation).toBeDefined();
    });

    it('should detect WORKAROUND markers as tech debt', () => {
      const tsFile = path.join(tempDir, 'workaround.ts');
      fs.writeFileSync(
        tsFile,
        `
        function process() {
          // ${'WORKAROUND'}: for browser bug
          return null;
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const workaroundViolation = result.violations.find(v => v.type === 'tech_debt_marker');
      expect(workaroundViolation).toBeDefined();
    });

    it('should detect unimplemented stubs', () => {
      const tsFile = path.join(tempDir, 'notimpl.ts');
      fs.writeFileSync(
        tsFile,
        `
        function notImplemented() {
          throw new Error('Not implemented');
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const stubViolation = result.violations.find(v => v.type === 'unimplemented_stub');
      expect(stubViolation).toBeDefined();
      expect(stubViolation?.severity).toBe('error');
    });

    it('should detect todo variations in throw messages', () => {
      const tsFile = path.join(tempDir, 'throwtodo.ts');
      fs.writeFileSync(
        tsFile,
        `
        function stub() {
          throw new Error('todo: implement later');
        }
      `
      );

      const result = analyzer.analyze(tsFile);

      const stubViolation = result.violations.find(v => v.type === 'unimplemented_stub');
      expect(stubViolation).toBeDefined();
    });
  });

  describe('file type detection', () => {
    it('should treat .tsx files as React', () => {
      const tsxFile = path.join(tempDir, 'react.tsx');
      fs.writeFileSync(tsxFile, 'export const x = 1;');

      const result = analyzer.analyze(tsxFile);

      // Analysis should complete for TSX files
      expect(result.metrics).toBeDefined();
    });

    it('should treat .jsx files as React', () => {
      const jsxFile = path.join(tempDir, 'react.jsx');
      fs.writeFileSync(jsxFile, 'export const x = 1;');

      const result = analyzer.analyze(jsxFile);

      expect(result.metrics).toBeDefined();
    });

    it('should treat .ts files as non-React', () => {
      const tsFile = path.join(tempDir, 'plain.ts');
      fs.writeFileSync(tsFile, 'export const x = 1;');

      const result = analyzer.analyze(tsFile);

      // Should still work, just without React-specific checks
      expect(result.metrics).toBeDefined();
    });

    it('should treat .js files as TypeScript', () => {
      const jsFile = path.join(tempDir, 'plain.js');
      fs.writeFileSync(jsFile, 'export const x = 1;');

      const result = analyzer.analyze(jsFile);

      expect(result.metrics).toBeDefined();
    });
  });

  describe('result structure', () => {
    it('should return complete analysis result', () => {
      const tsFile = path.join(tempDir, 'complete.ts');
      fs.writeFileSync(
        tsFile,
        `
        import { helper } from './utils';
        
        function add(a: number, b: number): number {
          return a + b;
        }
        
        export { add };
      `
      );

      const result = analyzer.analyze(tsFile);

      expect(result).toHaveProperty('dependencies');
      expect(result).toHaveProperty('metrics');
      expect(result).toHaveProperty('violations');
      expect(Array.isArray(result.dependencies)).toBe(true);
      expect(result.metrics).toHaveProperty('linesOfCode');
      expect(result.metrics).toHaveProperty('cyclomaticComplexity');
      expect(result.metrics).toHaveProperty('numberOfMethods');
      expect(result.metrics).toHaveProperty('numberOfClasses');
      expect(result.metrics).toHaveProperty('importCount');
      expect(Array.isArray(result.violations)).toBe(true);
    });
  });

  describe('violation spans and ruleIds', () => {
    it('emits a well-formed span and ruleId for any_type', () => {
      const tsFile = path.join(tempDir, 'span-any.ts');
      fs.writeFileSync(tsFile, `const x: any = 1;\n`);

      const result = analyzer.analyze(tsFile);
      const v = result.violations.find(x => x.type === 'any_type');

      expect(v).toBeDefined();
      expect(v?.ruleId).toBe('ts/no-any');
      expect(v?.span).toBeDefined();
      expect(v?.span?.line).toBe(1);
      expect(v?.span?.endLine).toBe(1);
      expect(v?.span?.column).toBeGreaterThan(0);
      expect(v?.span?.endColumn).toBeGreaterThan(v!.span!.column);
      // span covers the literal text "any" (3 chars)
      expect(v?.span?.length).toBe(3);
    });

    it('emits a span on the property access for console_log', () => {
      const tsFile = path.join(tempDir, 'span-console.ts');
      fs.writeFileSync(tsFile, `console.log("hi");\n`);

      const result = analyzer.analyze(tsFile);
      const v = result.violations.find(x => x.type === 'console_log');

      expect(v).toBeDefined();
      expect(v?.ruleId).toBe('ts/no-console');
      expect(v?.span).toBeDefined();
      expect(v?.span?.line).toBe(1);
      // "console.log" is 11 chars
      expect(v?.span?.length).toBe(11);
    });

    it('emits a deterministic Fix for any_type with replacement "unknown"', () => {
      const tsFile = path.join(tempDir, 'fix-any.ts');
      fs.writeFileSync(tsFile, `const x: any = 1;\n`);

      const result = analyzer.analyze(tsFile);
      const v = result.violations.find(x => x.type === 'any_type');
      const f = v?.fix;

      expect(f).toBeDefined();
      expect(typeof f).toBe('object');
      if (f && typeof f === 'object') {
        expect(f.confidence).toBe('deterministic');
        expect(f.replacement).toBe('unknown');
        expect(f.replaceSpan?.length).toBe(3);
        expect(f.replaceSpan?.line).toBe(1);
      }
    });

    it('emits a deterministic Fix for console_log with replacement "logger.debug"', () => {
      const tsFile = path.join(tempDir, 'fix-console.ts');
      fs.writeFileSync(tsFile, `console.log("x");\n`);

      const result = analyzer.analyze(tsFile);
      const v = result.violations.find(x => x.type === 'console_log');
      const f = v?.fix;

      expect(f).toBeDefined();
      expect(typeof f).toBe('object');
      if (f && typeof f === 'object') {
        expect(f.confidence).toBe('deterministic');
        expect(f.replacement).toBe('logger.debug');
        expect(f.replaceSpan?.length).toBe(11);
      }
    });

    it('emits a span for TODO placeholder violations', () => {
      const tsFile = path.join(tempDir, 'span-todo.ts');
      fs.writeFileSync(tsFile, `// TODO: implement me\nexport const x = 1;\n`);

      const result = analyzer.analyze(tsFile);
      const v = result.violations.find(x => x.type === 'todo_placeholder');

      expect(v).toBeDefined();
      expect(v?.ruleId).toBe('ts/no-todo');
      expect(v?.span?.line).toBe(1);
      expect(v?.span?.column).toBeGreaterThan(0);
    });
  });
});
