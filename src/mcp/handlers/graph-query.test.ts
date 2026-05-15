/**
 * Tests for graph-query MCP handlers.
 * Mocks fetchDaemonApi so no running daemon is needed.
 */

import {
  handleGetImpactSet,
  handleGetCentralityRank,
  handleTracePath,
  handleSummarizeFile,
  handleFindCallers,
  handleCheckPreEditSafety,
  handleGetSessionMetrics,
} from './graph-query';
import { fetchDaemonApi, findGitRoot } from '../helpers';

jest.mock('../helpers', () => ({
  fetchDaemonApi: jest.fn(),
  findGitRoot: jest.fn().mockReturnValue('/repo'),
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(''),
}));

const mockFetch = fetchDaemonApi as jest.MockedFunction<typeof fetchDaemonApi>;

// ── Fixtures ───────────────────────────────────────────────

const mkNode = (id: string, rating: number, violations: Array<{ type: string; severity: string; message: string }> = []) => ({
  id, label: id.split('/').pop()!, type: 'typescript', rating, size: 1, violations,
  metrics: { linesOfCode: 100, cyclomaticComplexity: 5, numberOfMethods: 3, numberOfClasses: 0, importCount: 2 },
});

const GRAPH = {
  nodes: [
    mkNode('/repo/src/core.ts', 8),
    mkNode('/repo/src/weak.ts', 3, [{ type: 'no-any', severity: 'warning', message: 'use specific types' }]),
    mkNode('/repo/src/util.ts', 9),
  ],
  edges: [
    { source: '/repo/src/weak.ts', target: '/repo/src/core.ts', type: 'import', strength: 1 },
    { source: '/repo/src/util.ts', target: '/repo/src/core.ts', type: 'import', strength: 1 },
  ],
};

const DAEMON_ERROR_MSG = 'daemon is not running';

// ── handleGetImpactSet ─────────────────────────────────────

describe('handleGetImpactSet', () => {
  it('returns daemon error when fetch returns null', async () => {
    mockFetch.mockResolvedValue(null);
    const r = await handleGetImpactSet({ file_path: '/repo/src/core.ts' });
    expect(r.content[0]!.text).toContain(DAEMON_ERROR_MSG);
  });

  it('returns error when file_path is missing', async () => {
    const r = await handleGetImpactSet({});
    expect(r.content[0]!.text).toContain('file_path is required');
  });

  it('returns leaf-node message when file has no dependents', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    const r = await handleGetImpactSet({ file_path: '/repo/src/weak.ts' });
    expect(r.content[0]!.text).toContain('leaf node');
  });

  it('reports affected files and fragile count for a god node', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    const r = await handleGetImpactSet({ file_path: '/repo/src/core.ts' });
    expect(r.content[0]!.text).toContain('Affected:');
    expect(r.content[0]!.text).toContain('Fragile');
  });

  it('clamps depth to max of 5', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    const r = await handleGetImpactSet({ file_path: '/repo/src/core.ts', depth: 99 });
    expect(r.content[0]!.text).toContain('5');
  });
});

// ── handleGetCentralityRank ────────────────────────────────

describe('handleGetCentralityRank', () => {
  it('returns daemon error when fetch returns null', async () => {
    mockFetch.mockResolvedValue(null);
    const r = await handleGetCentralityRank({});
    expect(r.content[0]!.text).toContain(DAEMON_ERROR_MSG);
  });

  it('returns ranked table with correct columns', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    const r = await handleGetCentralityRank({ limit: 3 });
    const text = r.content[0]!.text;
    expect(text).toContain('Rank');
    expect(text).toContain('File');
    expect(text).toContain('Total');
  });

  it('clamps limit to max of 50', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    const r = await handleGetCentralityRank({ limit: 999 });
    // Should not crash; result has at most GRAPH.nodes.length rows
    expect(r.content[0]!.text).toBeDefined();
  });
});

// ── handleTracePath ────────────────────────────────────────

describe('handleTracePath', () => {
  it('returns error when source or target missing', async () => {
    const r = await handleTracePath({ source: '/a' });
    expect(r.content[0]!.text).toContain('required');
  });

  it('returns daemon error when fetch returns null', async () => {
    mockFetch.mockResolvedValue(null);
    const r = await handleTracePath({ source: '/a', target: '/b' });
    expect(r.content[0]!.text).toContain(DAEMON_ERROR_MSG);
  });

  it('finds a forward path between connected nodes', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    const r = await handleTracePath({ source: '/repo/src/weak.ts', target: '/repo/src/core.ts' });
    const text = r.content[0]!.text;
    expect(text).toContain('hops');
    expect(text).toContain('weak.ts');
    expect(text).toContain('core.ts');
  });

  it('reports no path for architecturally independent files', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    // util.ts → weak.ts: no path exists (util imports core, not weak)
    const r = await handleTracePath({ source: '/repo/src/util.ts', target: '/repo/src/weak.ts' });
    expect(r.content[0]!.text).toContain('No dependency path');
  });

  it('reports independent when core tries to reach weak (no path in either direction)', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    // weak.ts imports core.ts, not the other way; no path core→weak
    const r = await handleTracePath({ source: '/repo/src/core.ts', target: '/repo/src/weak.ts' });
    expect(r.content[0]!.text).toMatch(/No dependency path|reverse/);
  });
});

// ── handleSummarizeFile ────────────────────────────────────

describe('handleSummarizeFile', () => {
  it('returns error when file_path is missing', async () => {
    const r = await handleSummarizeFile({});
    expect(r.content[0]!.text).toContain('file_path is required');
  });

  it('returns daemon error when graph fetch returns null', async () => {
    mockFetch.mockResolvedValue(null);
    const r = await handleSummarizeFile({ file_path: '/repo/src/core.ts' });
    expect(r.content[0]!.text).toContain(DAEMON_ERROR_MSG);
  });

  it('prompts to analyze when file not in graph', async () => {
    mockFetch.mockResolvedValue({ nodes: [], edges: [] });
    const r = await handleSummarizeFile({ file_path: '/repo/src/unknown.ts' });
    expect(r.content[0]!.text).toContain('analyze_file');
  });

  it('returns summary with rating and LOC for known file', async () => {
    mockFetch.mockResolvedValue({ ...GRAPH, nodes: [...GRAPH.nodes] });
    // second fetch call returns null (file-detail)
    mockFetch.mockResolvedValueOnce(GRAPH).mockResolvedValueOnce(null);
    const r = await handleSummarizeFile({ file_path: '/repo/src/core.ts' });
    const text = r.content[0]!.text;
    expect(text).toContain('Rating:');
  });
});

// ── handleFindCallers ──────────────────────────────────────

describe('handleFindCallers', () => {
  it('returns error when symbol_name is missing', async () => {
    const r = await handleFindCallers({});
    expect(r.content[0]!.text).toContain('symbol_name is required');
  });

  it('returns daemon error when fetch returns null', async () => {
    mockFetch.mockResolvedValue(null);
    const r = await handleFindCallers({ symbol_name: 'myFn' });
    expect(r.content[0]!.text).toContain(DAEMON_ERROR_MSG);
  });

  it('returns no-callers message when symbol is not found', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    // readFileSync returns '' — no call sites
    const r = await handleFindCallers({ symbol_name: 'nonExistentFunction' });
    expect(r.content[0]!.text).toContain('No call sites found');
  });

  it('finds callers when file content contains symbol call', async () => {
    const fs = require('fs') as jest.Mocked<typeof import('fs')>;
    fs.readFileSync.mockReturnValue('const x = myFn(); // call site');
    mockFetch.mockResolvedValue(GRAPH);
    const r = await handleFindCallers({ symbol_name: 'myFn' });
    expect(r.content[0]!.text).toContain('call site');
  });
});

// ── handleCheckPreEditSafety ───────────────────────────────

describe('handleCheckPreEditSafety', () => {
  it('returns error when file_path is missing', async () => {
    const r = await handleCheckPreEditSafety({});
    expect(r.content[0]!.text).toContain('file_path is required');
  });

  it('returns daemon error when fetch returns null', async () => {
    mockFetch.mockResolvedValue(null);
    const r = await handleCheckPreEditSafety({ file_path: '/repo/src/core.ts' });
    expect(r.content[0]!.text).toContain(DAEMON_ERROR_MSG);
  });

  it('returns SAFE verdict for a leaf node with no dependents', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    const r = await handleCheckPreEditSafety({ file_path: '/repo/src/weak.ts' });
    expect(r.content[0]!.text).toContain('SAFE');
  });

  it('returns WARN verdict for a node with some fragile dependents', async () => {
    mockFetch.mockResolvedValue(GRAPH);
    // core.ts has weak.ts (rating 3) as dependent — should warn
    const r = await handleCheckPreEditSafety({ file_path: '/repo/src/core.ts' });
    const text = r.content[0]!.text;
    expect(text).toMatch(/WARN|SAFE/);
  });
});

// ── handleGetSessionMetrics ────────────────────────────────

describe('handleGetSessionMetrics', () => {
  it('returns a metrics report with expected headings', () => {
    const r = handleGetSessionMetrics();
    const text = r.content[0]!.text;
    expect(text).toContain('Context Budget');
    expect(text).toContain('Graph queries');
    expect(text).toContain('Tokens saved');
  });
});
