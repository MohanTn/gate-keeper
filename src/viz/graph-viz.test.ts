import { generateGraphViz } from './graph-viz';

const nodes = [
  { id: '/repo/src/auth.ts', label: 'auth.ts', rating: 8, metrics: { linesOfCode: 100, cyclomaticComplexity: 5, importCount: 3 }, violations: [] },
  { id: '/repo/src/db.ts', label: 'db.ts', rating: 4, metrics: { linesOfCode: 200, cyclomaticComplexity: 12, importCount: 6 }, violations: [{ type: 'any_type', severity: 'warning' }] },
  { id: '/repo/src/utils.ts', label: 'utils.ts', rating: 9, metrics: { linesOfCode: 50 }, violations: [] },
];

const edges = [
  { source: '/repo/src/auth.ts', target: '/repo/src/db.ts', type: 'IMPORT' },
  { source: '/repo/src/auth.ts', target: '/repo/src/utils.ts', type: 'FUNCTION_CALL' },
];

describe('generateGraphViz', () => {
  it('returns a non-empty HTML string', () => {
    const html = generateGraphViz(nodes, edges);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(500);
  });

  it('is a valid HTML document', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('embeds graph data as JSON', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('"auth.ts"');
    expect(html).toContain('"db.ts"');
    expect(html).toContain('"utils.ts"');
  });

  it('embeds edge data', () => {
    const html = generateGraphViz(nodes, edges);
    // Edges are serialised as {s, t, tp}
    expect(html).toContain('"FUNCTION_CALL"');
    expect(html).toContain('"IMPORT"');
  });

  it('includes node metric data', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('"loc":100');
    expect(html).toContain('"complexity":5');
  });

  it('counts errors and warnings from violations', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('"warnings":1'); // db.ts has 1 warning
    expect(html).toContain('"errors":0');
  });

  it('includes force simulation JS', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('requestAnimationFrame');
    expect(html).toContain('REPEL');
  });

  it('includes search input', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('id="search"');
  });

  it('includes detail panel', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('id="panel"');
    expect(html).toContain('close-panel');
  });

  it('includes legend', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('legend');
    expect(html).toContain('≥8');
  });

  it('uses custom title', () => {
    const html = generateGraphViz(nodes, edges, { title: 'My Project Graph' });
    expect(html).toContain('My Project Graph');
  });

  it('escapes HTML special chars in title', () => {
    const html = generateGraphViz(nodes, edges, { title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('works with empty graph', () => {
    const html = generateGraphViz([], []);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('"nodes":[]');
    expect(html).toContain('"edges":[]');
  });

  it('includes pan/zoom handlers', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('pointerdown');
    expect(html).toContain('wheel');
  });

  it('includes SVG container', () => {
    const html = generateGraphViz(nodes, edges);
    expect(html).toContain('id="svg"');
    expect(html).toContain('g-edges');
    expect(html).toContain('g-nodes');
  });
});
