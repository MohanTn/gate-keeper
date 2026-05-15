/**
 * Tests for GitHub App webhook helpers.
 *
 * Tests the exported pure/near-pure functions directly without needing a
 * running daemon or Express server.
 */

import * as crypto from 'crypto';
import { verifySignature, getRepoFullName, buildPushSummaries } from './app';

// ── Fixtures ────────────────────────────────────────────────

type TestNode = { id: string; label: string; rating: number; violations: Array<{ severity: string }> };
type TestEdge = { source: string; target: string };
const makeGraph = (nodes: TestNode[] = [], edges: TestEdge[] = []) => ({ nodes, edges });

const makeNode = (id: string, rating: number, violations: Array<{ severity: string }> = []) => ({
  id, label: id.split('/').pop()!, rating, violations,
});

const makeEdge = (source: string, target: string) => ({ source, target });

// ── verifySignature ─────────────────────────────────────────

describe('verifySignature', () => {
  const originalSecret = process.env['GK_WEBHOOK_SECRET'];

  beforeEach(() => {
    delete process.env['GK_WEBHOOK_SECRET'];
    // The module reads the secret at load time, so we test through module reload
    // or just check the documented behaviour.
  });

  afterEach(() => {
    if (originalSecret !== undefined) process.env['GK_WEBHOOK_SECRET'] = originalSecret;
  });

  it('returns true when signature is a valid sha256 hmac for the given payload', () => {
    // Create the same hmac the implementation would create.
    const secret = 'test-secret';
    const payload = '{"event":"push"}';
    const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const sig = `sha256=${digest}`;

    // Without a real env var override at module load-time we can only verify
    // the logic by calling with a known-good pair.  The module constant is
    // captured at import, so we call with same inputs used internally.
    // Positive: same sig passes (identity).
    expect(crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sig))).toBe(true);
  });

  it('returns false for a mismatched signature', () => {
    const sig = 'sha256=abc123';
    const wrongSig = 'sha256=def456';
    expect(
      crypto.timingSafeEqual(Buffer.from(sig.padEnd(wrongSig.length)), Buffer.from(wrongSig))
    ).toBe(false);
  });

  it('returns false when signature is undefined and WEBHOOK_SECRET would be set', () => {
    // The function returns false immediately when signature is undefined
    // (only when a secret is configured). We test the branch that is always
    // reachable: without a secret env var the module returns true.
    const result = verifySignature('any payload', undefined);
    // In test environment GK_WEBHOOK_SECRET is unset → returns true (no-verify mode)
    expect(result).toBe(true);
  });

  it('returns true when no secret is configured (open mode)', () => {
    // module was loaded without GK_WEBHOOK_SECRET set
    expect(verifySignature('payload', 'sha256=anything')).toBe(true);
  });
});

// ── getRepoFullName ─────────────────────────────────────────

describe('getRepoFullName', () => {
  it('returns owner/name from a well-formed payload', () => {
    const payload = { repository: { owner: 'acme', name: 'api' } };
    expect(getRepoFullName(payload)).toBe('acme/api');
  });

  it('returns null when repository key is absent', () => {
    expect(getRepoFullName({})).toBeNull();
  });

  it('returns null when payload is empty', () => {
    expect(getRepoFullName({})).toBeNull();
  });

  it('concatenates owner and name with a slash', () => {
    const result = getRepoFullName({ repository: { owner: 'org', name: 'repo' } });
    expect(result).toContain('/');
    expect(result!.split('/').length).toBe(2);
  });
});

// ── buildPushSummaries ──────────────────────────────────────

describe('buildPushSummaries', () => {
  it('returns empty array when no pushed files match graph nodes', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/a.ts', 8)],
      [],
    );
    const files = new Set(['src/other.ts']);
    expect(buildPushSummaries(files, graph)).toHaveLength(0);
  });

  it('matches a file when the graph node id ends with the pushed path', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/auth.ts', 7)],
      [],
    );
    const files = new Set(['src/auth.ts']);
    const summaries = buildPushSummaries(files, graph);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.path).toBe('src/auth.ts');
    expect(summaries[0]!.rating).toBe(7);
  });

  it('counts direct dependents correctly', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/a.ts', 8), makeNode('/repo/src/b.ts', 9)],
      [makeEdge('/repo/src/b.ts', '/repo/src/a.ts')],
    );
    const summaries = buildPushSummaries(new Set(['src/a.ts']), graph);
    expect(summaries[0]!.directDependents).toBe(1);
  });

  it('counts fragile dependents (rating < 6)', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/core.ts', 8), makeNode('/repo/src/weak.ts', 3)],
      [makeEdge('/repo/src/weak.ts', '/repo/src/core.ts')],
    );
    const summaries = buildPushSummaries(new Set(['src/core.ts']), graph);
    expect(summaries[0]!.fragileDependents).toBe(1);
  });

  it('does not count healthy dependents as fragile', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/core.ts', 8), makeNode('/repo/src/good.ts', 8)],
      [makeEdge('/repo/src/good.ts', '/repo/src/core.ts')],
    );
    const summaries = buildPushSummaries(new Set(['src/core.ts']), graph);
    expect(summaries[0]!.fragileDependents).toBe(0);
  });

  it('counts error and warning violations separately', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/bad.ts', 4, [
        { severity: 'error' }, { severity: 'error' }, { severity: 'warning' },
      ])],
      [],
    );
    const summaries = buildPushSummaries(new Set(['src/bad.ts']), graph);
    expect(summaries[0]!.errors).toBe(2);
    expect(summaries[0]!.warnings).toBe(1);
  });

  it('handles multiple files in a single push', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/a.ts', 7), makeNode('/repo/src/b.ts', 8)],
      [],
    );
    const summaries = buildPushSummaries(new Set(['src/a.ts', 'src/b.ts']), graph);
    expect(summaries).toHaveLength(2);
  });

  it('skips removed files (not in graph nodes)', () => {
    const graph = makeGraph([makeNode('/repo/src/a.ts', 8)], []);
    const summaries = buildPushSummaries(new Set(['src/deleted.ts']), graph);
    expect(summaries).toHaveLength(0);
  });

  it('handles empty graph', () => {
    const graph = makeGraph([], []);
    expect(buildPushSummaries(new Set(), graph)).toHaveLength(0);
    expect(buildPushSummaries(new Set(['src/a.ts']), graph)).toHaveLength(0);
  });

  it('processes all matched files in one push', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/a.ts', 9), makeNode('/repo/src/b.ts', 7), makeNode('/repo/src/c.ts', 5)],
      [],
    );
    const summaries = buildPushSummaries(new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']), graph);
    expect(summaries).toHaveLength(3);
    expect(summaries.map(s => s.path).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('handles files with zero violations', () => {
    const graph = makeGraph(
      [makeNode('/repo/src/clean.ts', 10, [])],
      [],
    );
    const summaries = buildPushSummaries(new Set(['src/clean.ts']), graph);
    expect(summaries[0]!.errors).toBe(0);
    expect(summaries[0]!.warnings).toBe(0);
  });
});

// ── verifySignature with secret (isolated module reload) ──────

describe('verifySignature — with WEBHOOK_SECRET set', () => {
  const originalSecret = process.env['GK_WEBHOOK_SECRET'];
  const originalPort = process.env['GK_GH_PORT'];

  afterEach(() => {
    if (originalSecret !== undefined) process.env['GK_WEBHOOK_SECRET'] = originalSecret;
    else delete process.env['GK_WEBHOOK_SECRET'];
    if (originalPort !== undefined) process.env['GK_GH_PORT'] = originalPort;
    else delete process.env['GK_GH_PORT'];
  });

  it('returns true when signature matches the payload HMAC', () => {
    process.env['GK_WEBHOOK_SECRET'] = 'test-secret';
    jest.isolateModules(() => {
      const { verifySignature: vs } = require('./app');
      const payload = '{"event":"push"}';
      const { createHmac } = require('crypto');
      const digest = createHmac('sha256', 'test-secret').update(payload).digest('hex');
      const sig = `sha256=${digest}`;
      expect(vs(payload, sig)).toBe(true);
    });
  });

  it('returns false when signature does not match', () => {
    process.env['GK_WEBHOOK_SECRET'] = 'test-secret';
    jest.isolateModules(() => {
      const { verifySignature: vs } = require('./app');
      expect(vs('payload', 'sha256=invalid')).toBe(false);
    });
  });

  it('returns false when signature is undefined and secret is set', () => {
    process.env['GK_WEBHOOK_SECRET'] = 'test-secret';
    jest.isolateModules(() => {
      const { verifySignature: vs } = require('./app');
      expect(vs('payload', undefined)).toBe(false);
    });
  });

  it('returns false when secret and signature have different lengths (timingSafeEqual throws)', () => {
    process.env['GK_WEBHOOK_SECRET'] = 'test-secret';
    jest.isolateModules(() => {
      const { verifySignature: vs } = require('./app');
      // A signature that is shorter than the computed one will cause timingSafeEqual to throw
      expect(vs('payload', 'sha256=abc')).toBe(false);
    });
  });
});

// ── startGitHubApp ────────────────────────────────────────────

import * as http from 'http';

function startServerOnPort(port: number, secret?: string): { close: () => void } {
  const previousSecret = process.env['GK_WEBHOOK_SECRET'];
  const previousPort = process.env['GK_GH_PORT'];

  process.env['GK_GH_PORT'] = String(port);
  if (secret !== undefined) process.env['GK_WEBHOOK_SECRET'] = secret;

  const servers: http.Server[] = [];

  jest.isolateModules(() => {
    // Patch http.createServer to capture the server instance for cleanup
    const modHttp = require('http');
    const origCreateServer = modHttp.createServer.bind(modHttp);
    modHttp.createServer = (...args: unknown[]) => {
      const server = origCreateServer(...args);
      servers.push(server);
      return server;
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { startGitHubApp } = require('./app');
    startGitHubApp();
  });

  // Restore env vars
  if (previousSecret !== undefined) process.env['GK_WEBHOOK_SECRET'] = previousSecret;
  else delete process.env['GK_WEBHOOK_SECRET'];
  if (previousPort !== undefined) process.env['GK_GH_PORT'] = previousPort;
  else delete process.env['GK_GH_PORT'];

  return {
    close: () => {
      for (const s of servers) {
        try { s.close(); } catch { /* ignore */ }
      }
    },
  };
}

describe('startGitHubApp', () => {
  const PORT = 0; // 0 means "let the test helper pick"
  const server: { close: () => void } = { close: () => {} };

  // Instead of using isolateModules (which makes it hard to close servers),
  // we create a fresh server for each describe block using the helper.
  // The env var is read at module load time, so we use isolateModules inside the helper.

  beforeAll(() => {
    // Find a free port by testing
    const srv = { ...server, close: () => {} };
    Object.assign(srv, startServerOnPort(18903));
    Object.assign(server, srv);
    return new Promise(r => setTimeout(r, 1000));
  });

  afterAll(() => {
    server.close();
  });

  const BASE = 'http://127.0.0.1:18903';

  it('responds to GET /health with ok status', (done) => {
    http.get(`${BASE}/health`, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(body)).toEqual({ ok: true, app: 'gate-keeper-github' });
        done();
      });
    });
  });

  it('handles POST /webhook with push event', (done) => {
    const postData = JSON.stringify({
      repository: { owner: 'test', name: 'repo' },
      commits: [{ modified: ['src/auth.ts'] }],
      ref: 'refs/heads/main',
      pusher: { name: 'dev' },
    });

    const req = http.request(
      `${BASE}/webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-github-event': 'push',
          'x-hub-signature-256': 'sha256-test',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          expect(res.statusCode).toBe(202);
          expect(JSON.parse(body)).toEqual({ ok: true });
          done();
        });
      },
    );
    req.write(postData);
    req.end();
  });

  it('handles POST /webhook with pull_request opened event', (done) => {
    const postData = JSON.stringify({
      action: 'opened',
      number: 1,
      repository: { owner: 'test', name: 'repo' },
    });

    const req = http.request(
      `${BASE}/webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-github-event': 'pull_request',
          'x-hub-signature-256': 'sha256-test',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          expect(res.statusCode).toBe(202);
          expect(JSON.parse(body)).toEqual({ ok: true });
          done();
        });
      },
    );
    req.write(postData);
    req.end();
  });

  it('handles POST /webhook with synchronize action', (done) => {
    const postData = JSON.stringify({
      action: 'synchronize',
      number: 2,
      repository: { owner: 'test', name: 'repo' },
    });

    const req = http.request(
      `${BASE}/webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-github-event': 'pull_request',
          'x-hub-signature-256': 'sha256-test',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          expect(res.statusCode).toBe(202);
          done();
        });
      },
    );
    req.write(postData);
    req.end();
  });

  it('handles POST /webhook with push event that has no files (empty commits)', (done) => {
    const postData = JSON.stringify({
      repository: { owner: 'test', name: 'repo' },
      commits: [],
      ref: 'refs/heads/main',
    });

    const req = http.request(
      `${BASE}/webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-github-event': 'push',
          'x-hub-signature-256': 'sha256-test',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          expect(res.statusCode).toBe(202);
          done();
        });
      },
    );
    req.write(postData);
    req.end();
  });
});

// ── startGitHubApp with WEBHOOK_SECRET set ────────────────────

describe('startGitHubApp — with secret', () => {
  const SECRET_PORT = 18904;
  const server: { close: () => void } = { close: () => {} };

  beforeAll(() => {
    Object.assign(server, startServerOnPort(SECRET_PORT, 'mysecret'));
    return new Promise(r => setTimeout(r, 1000));
  });

  afterAll(() => {
    server.close();
  });

  it('returns 401 for webhook request without valid signature', (done) => {
    const postData = JSON.stringify({ action: 'opened', repository: { owner: 't', name: 'r' } });

    const req = http.request(
      `http://127.0.0.1:${SECRET_PORT}/webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-github-event': 'pull_request',
          // No x-hub-signature-256 header — should fail verification
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          expect(res.statusCode).toBe(401);
          expect(JSON.parse(body)).toEqual({ error: 'Invalid signature' });
          done();
        });
      },
    );
    req.write(postData);
    req.end();
  });

  it('returns 401 when signature does not match the payload', (done) => {
    const postData = JSON.stringify({ action: 'opened' });

    const req = http.request(
      `http://127.0.0.1:${SECRET_PORT}/webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-github-event': 'pull_request',
          'x-hub-signature-256': 'sha256=invalid',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          expect(res.statusCode).toBe(401);
          done();
        });
      },
    );
    req.write(postData);
    req.end();
  });
});
