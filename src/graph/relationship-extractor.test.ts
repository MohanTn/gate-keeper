/**
 * Tests for RelationshipExtractor.
 *
 * Creates real TypeScript files in a temp directory so the extractor
 * can use `fs.existsSync` and `ts.createSourceFile` on actual content.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RelationshipExtractor } from './relationship-extractor';

let tmpDir: string;
let extractor: RelationshipExtractor;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-extractor-'));
  extractor = new RelationshipExtractor();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

// ── Function call extraction ──────────────────────────────

describe('FUNCTION_CALL extraction', () => {
  it('detects a direct call to an imported function', () => {
    const service = write('service.ts', `export function login() {}`);
    const consumer = write('consumer.ts', `
      import { login } from './service';
      login();
    `);
    const known = new Set([service, consumer]);
    const { enrichedEdges } = extractor.extractFromFile(consumer, known);
    const callEdge = enrichedEdges.find(e => e.type === 'FUNCTION_CALL');
    expect(callEdge).toBeDefined();
    expect(callEdge!.source).toBe(consumer);
    expect(callEdge!.target).toBe(service);
    expect(callEdge!.confidence).toBe('EXTRACTED');
  });

  it('detects a new expression (constructor call)', () => {
    const base = write('base.ts', `export class Repo {}`);
    const consumer = write('consumer.ts', `
      import { Repo } from './base';
      const r = new Repo();
    `);
    const known = new Set([base, consumer]);
    const { enrichedEdges } = extractor.extractFromFile(consumer, known);
    const callEdge = enrichedEdges.find(e => e.type === 'FUNCTION_CALL');
    expect(callEdge).toBeDefined();
    expect(callEdge!.target).toBe(base);
  });

  it('detects method call on imported namespace', () => {
    const utils = write('utils.ts', `export const logger = { log() {} };`);
    const consumer = write('consumer.ts', `
      import * as logger from './utils';
      logger.log('hello');
    `);
    const known = new Set([utils, consumer]);
    const { enrichedEdges } = extractor.extractFromFile(consumer, known);
    const callEdge = enrichedEdges.find(e => e.type === 'FUNCTION_CALL');
    expect(callEdge).toBeDefined();
  });

  it('deduplicates multiple calls to the same imported file', () => {
    const service = write('service.ts', `
      export function a() {}
      export function b() {}
    `);
    const consumer = write('consumer.ts', `
      import { a, b } from './service';
      a(); b(); a();
    `);
    const known = new Set([service, consumer]);
    const { enrichedEdges } = extractor.extractFromFile(consumer, known);
    const callEdges = enrichedEdges.filter(e => e.type === 'FUNCTION_CALL' && e.target === service);
    expect(callEdges).toHaveLength(1);
  });

  it('ignores calls to npm package imports', () => {
    const consumer = write('consumer.ts', `
      import * as path from 'path';
      path.join('a', 'b');
    `);
    const known = new Set([consumer]);
    const { enrichedEdges } = extractor.extractFromFile(consumer, known);
    expect(enrichedEdges).toHaveLength(0);
  });

  it('ignores imports to files not in knownFiles', () => {
    const consumer = write('consumer.ts', `
      import { foo } from './unknown-module';
      foo();
    `);
    const known = new Set([consumer]); // unknown-module not in known
    const { enrichedEdges } = extractor.extractFromFile(consumer, known);
    expect(enrichedEdges).toHaveLength(0);
  });
});

// ── Class heritage extraction ─────────────────────────────

describe('CLASS_EXTENDS / IMPLEMENTS extraction', () => {
  it('detects class extends', () => {
    const base = write('base.ts', `export class Base {}`);
    const child = write('child.ts', `
      import { Base } from './base';
      export class Child extends Base {}
    `);
    const known = new Set([base, child]);
    const { enrichedEdges } = extractor.extractFromFile(child, known);
    const extendsEdge = enrichedEdges.find(e => e.type === 'CLASS_EXTENDS');
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge!.source).toBe(child);
    expect(extendsEdge!.target).toBe(base);
    expect(extendsEdge!.rationale).toContain('extends');
  });

  it('detects implements interface', () => {
    const iface = write('interface.ts', `export interface IService {}`);
    const impl = write('impl.ts', `
      import { IService } from './interface';
      export class ServiceImpl implements IService {}
    `);
    const known = new Set([iface, impl]);
    const { enrichedEdges } = extractor.extractFromFile(impl, known);
    const implEdge = enrichedEdges.find(e => e.type === 'IMPLEMENTS');
    expect(implEdge).toBeDefined();
    expect(implEdge!.source).toBe(impl);
    expect(implEdge!.target).toBe(iface);
  });

  it('detects both extends and implements in one class', () => {
    const base = write('base.ts', `export class Base {}`);
    const iface = write('iface.ts', `export interface IFoo {}`);
    const child = write('child.ts', `
      import { Base } from './base';
      import { IFoo } from './iface';
      export class Child extends Base implements IFoo {}
    `);
    const known = new Set([base, iface, child]);
    const { enrichedEdges } = extractor.extractFromFile(child, known);
    expect(enrichedEdges.find(e => e.type === 'CLASS_EXTENDS')).toBeDefined();
    expect(enrichedEdges.find(e => e.type === 'IMPLEMENTS')).toBeDefined();
  });

  it('assigns higher weight to CLASS_EXTENDS than FUNCTION_CALL', () => {
    const base = write('base.ts', `export class B {}`);
    const service = write('service.ts', `export function fn() {}`);
    const child = write('child.ts', `
      import { B } from './base';
      import { fn } from './service';
      export class C extends B {}
      fn();
    `);
    const known = new Set([base, service, child]);
    const { enrichedEdges } = extractor.extractFromFile(child, known);
    const ext = enrichedEdges.find(e => e.type === 'CLASS_EXTENDS')!;
    const call = enrichedEdges.find(e => e.type === 'FUNCTION_CALL')!;
    expect(ext.weight).toBeGreaterThan(call.weight);
  });
});

// ── Why comment extraction ────────────────────────────────

describe('Why comment extraction', () => {
  it('extracts // why: comments', () => {
    const f = write('a.ts', `
      // why: we use singleton to avoid connection leaks
      const pool = createPool();
    `);
    const { whyComments } = extractor.extractFromFile(f, new Set([f]));
    const why = whyComments.find(w => w.text.includes('singleton'));
    expect(why).toBeDefined();
    expect(why!.line).toBeGreaterThan(0);
    expect(why!.file).toBe(f);
  });

  it('extracts // rationale: comments', () => {
    const f = write('b.ts', `
      // rationale: exponential backoff prevents thundering herd
      function retry() {}
    `);
    const { whyComments } = extractor.extractFromFile(f, new Set([f]));
    expect(whyComments.some(w => w.text.includes('exponential'))).toBe(true);
  });

  it('extracts JSDoc summaries', () => {
    const f = write('c.ts', `
      /** Handles JWT token generation and validation. */
      export function createToken() {}
    `);
    const { whyComments } = extractor.extractFromFile(f, new Set([f]));
    expect(whyComments.some(w => w.text.includes('JWT'))).toBe(true);
  });

  it('ignores JSDoc @tag-only blocks', () => {
    const f = write('d.ts', `
      /**
       * @param x - the value
       * @returns the result
       */
      export function fn(x: number) { return x; }
    `);
    const { whyComments } = extractor.extractFromFile(f, new Set([f]));
    // Should not extract the @param/@returns only block
    const jsdocs = whyComments.filter(w => w.id.includes('jsdoc'));
    expect(jsdocs).toHaveLength(0);
  });

  it('handles files with no comments gracefully', () => {
    const f = write('e.ts', `export const x = 1;`);
    const { whyComments } = extractor.extractFromFile(f, new Set([f]));
    expect(whyComments).toHaveLength(0);
  });
});

// ── Edge cases ────────────────────────────────────────────

describe('Edge cases', () => {
  it('returns empty result for non-existent file', () => {
    const result = extractor.extractFromFile('/non/existent/file.ts', new Set());
    expect(result.enrichedEdges).toHaveLength(0);
    expect(result.whyComments).toHaveLength(0);
  });

  it('returns empty result for empty file', () => {
    const f = write('empty.ts', '');
    const result = extractor.extractFromFile(f, new Set([f]));
    expect(result.enrichedEdges).toHaveLength(0);
  });

  it('sets confidence to EXTRACTED for all edges', () => {
    const base = write('base.ts', `export class B {}`);
    const child = write('child.ts', `
      import { B } from './base';
      export class C extends B {}
    `);
    const known = new Set([base, child]);
    const { enrichedEdges } = extractor.extractFromFile(child, known);
    for (const e of enrichedEdges) {
      expect(e.confidence).toBe('EXTRACTED');
    }
  });
});
