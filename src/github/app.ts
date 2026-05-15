/**
 * GitHub App webhook handler.
 *
 * Listens for push and pull_request webhooks from GitHub, runs graph analysis
 * on changed files, and logs impact summaries to stderr.
 *
 * Configure via:
 *   EXPOSE_GITHUB_APP=true GK_WEBHOOK_SECRET=<secret> GK_GITHUB_TOKEN=<token> npx tsx src/github/app.ts
 *
 * GK_GITHUB_TOKEN is required for pull_request analysis (used to fetch changed files from the GitHub API).
 */

import express from 'express';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { formatPRComment, PRMetadata, GraphNodeSummary } from './commenter';

const PORT = parseInt(process.env['GK_GH_PORT'] ?? '5432', 10);
const WEBHOOK_SECRET = process.env['GK_WEBHOOK_SECRET'] ?? '';
const DAEMON_PORT = 5378;

// ── Helpers ────────────────────────────────────────────────

function fetchDaemonApi(urlPath: string): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${DAEMON_PORT}${urlPath}`, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

export function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET) return true;
  if (!signature) return false;
  const sig = `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function getRepoFullName(payload: Record<string, unknown>): string | null {
  const repo = payload['repository'] as Record<string, unknown> | undefined;
  return repo ? `${repo['owner']}/${repo['name']}` : null;
}

type GraphNode = { id: string; label: string; rating: number; violations: Array<{ severity: string }> };
type GraphEdge = { source: string; target: string };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export function buildPushSummaries(allFiles: Set<string>, graph: GraphData): GraphNodeSummary[] {
  const summaries: GraphNodeSummary[] = [];
  for (const file of allFiles) {
    const node = graph.nodes.find(n => n.id.endsWith(file));
    if (!node) continue;
    const dependents = graph.edges.filter(e => e.target === node.id);
    const fragile = graph.nodes.filter(n => dependents.some(d => d.source === n.id) && n.rating < 6);
    summaries.push({
      path: file,
      rating: node.rating,
      directDependents: dependents.length,
      fragileDependents: fragile.length,
      errors: node.violations.filter(v => v.severity === 'error').length,
      warnings: node.violations.filter(v => v.severity === 'warning').length,
    });
  }
  return summaries;
}

// ── Webhook handlers ──────────────────────────────────────

async function handlePush(payload: Record<string, unknown>): Promise<void> {
  const repoName = getRepoFullName(payload);
  const commits = (payload['commits'] ?? []) as Array<{ modified?: string[]; added?: string[]; removed?: string[] }>;
  const allFiles = new Set<string>();
  for (const c of commits) {
    for (const f of c.modified ?? []) allFiles.add(f);
    for (const f of c.added ?? []) allFiles.add(f);
  }
  if (allFiles.size === 0 || !repoName) return;

  const graphRaw = await fetchDaemonApi(`/api/graph`);
  if (!graphRaw) return;

  const summaries = buildPushSummaries(allFiles, graphRaw as GraphData);
  if (summaries.length === 0) return;

  const ref = (payload['ref'] as string) ?? 'unknown';
  const pr = {
    number: 0,
    title: `Push to ${ref}`,
    author: (payload['pusher'] as Record<string, string>)?.['name'] ?? 'unknown',
    baseBranch: ref.replace('refs/heads/', ''),
    headBranch: ref.replace('refs/heads/', ''),
  };
  const comment = formatPRComment(pr, summaries, repoName, (graphRaw as GraphData).nodes.length);
  process.stderr.write(`[gate-keeper-github] Push analysis: ${summaries.length} files changed, verdict=${comment.verdict}\n`);
  for (const s of summaries) {
    process.stderr.write(`[gate-keeper-github]   ${s.path}: ${s.rating}/10, ${s.fragileDependents} fragile\n`);
  }
}

async function handlePullRequest(payload: Record<string, unknown>): Promise<void> {
  const action = payload['action'] as string;
  if (action !== 'opened' && action !== 'synchronize') return;

  const repoName = getRepoFullName(payload);
  const pr = payload['pull_request'] as Record<string, unknown> | undefined;
  if (!repoName || !pr) return;

  const token = process.env['GK_GITHUB_TOKEN'];
  if (!token) {
    process.stderr.write(`[gate-keeper-github] PR #${payload['number']} ${action} — set GK_GITHUB_TOKEN to enable PR file analysis\n`);
    return;
  }

  const [owner, repo] = repoName.split('/');
  if (!owner || !repo) return;

  const prFiles = await fetchPRFiles(owner, repo, payload['number'] as number, token);
  if (prFiles.length === 0) return;

  const allFiles = new Set(prFiles.map(f => f.filename));
  const graphRaw = await fetchDaemonApi('/api/graph');
  if (!graphRaw) return;

  const summaries = buildPushSummaries(allFiles, graphRaw as GraphData);
  if (summaries.length === 0) return;

  const prMeta: PRMetadata = {
    number: payload['number'] as number,
    title: (pr['title'] as string) ?? 'Untitled PR',
    author: ((pr['user'] as Record<string, string>)?.['login']) ?? 'unknown',
    baseBranch: ((pr['base'] as Record<string, string>)?.['ref']) ?? 'main',
    headBranch: ((pr['head'] as Record<string, string>)?.['ref']) ?? 'feature',
  };
  const comment = formatPRComment(prMeta, summaries, repoName, (graphRaw as GraphData).nodes.length);
  process.stderr.write(`[gate-keeper-github] PR #${prMeta.number} (${action}): ${summaries.length} files analyzed, verdict=${comment.verdict}\n`);
  for (const s of summaries) {
    process.stderr.write(`[gate-keeper-github]   ${s.path}: ${s.rating}/10, ${s.fragileDependents} fragile\n`);
  }
}

function fetchPRFiles(
  owner: string, repo: string, prNumber: number, token: string
): Promise<Array<{ filename: string }>> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/pulls/${prNumber}/files`,
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'gate-keeper',
          Accept: 'application/vnd.github+json',
        },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body) as Array<{ filename: string }>); }
          catch { resolve([]); }
        });
      },
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

async function dispatchWebhookEvent(event: string, payload: Record<string, unknown>): Promise<void> {
  if (event === 'push') {
    await handlePush(payload);
  } else if (event === 'pull_request') {
    await handlePullRequest(payload);
  }
}

// ── Server ─────────────────────────────────────────────────

export function startGitHubApp(): void {
  const app = express();

  app.post('/webhook', express.json({
    verify: (req: express.Request, _res: express.Response, buf: Buffer) => {
      (req as unknown as Record<string, Buffer>)['rawBody'] = buf;
    },
  }), async (req, res) => {
    const rawBody = (req as unknown as Record<string, Buffer>)['rawBody'] as Buffer;
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const event = req.headers['x-github-event'] as string;

    if (!verifySignature(rawBody?.toString() ?? '', signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    res.status(202).json({ ok: true });

    try {
      await dispatchWebhookEvent(event, req.body as Record<string, unknown>);
    } catch (err) {
      process.stderr.write(`[gate-keeper-github] Webhook error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, app: 'gate-keeper-github' });
  });

  app.listen(PORT, () => {
    process.stderr.write(`[gate-keeper-github] Webhook server on :${PORT} (secret: ${WEBHOOK_SECRET ? 'set' : 'NOT SET'})\n`);
  });
}

if (require.main === module) {
  if (!process.env['EXPOSE_GITHUB_APP']) {
    process.stderr.write('Set EXPOSE_GITHUB_APP=true to start the GitHub App webhook server.\n');
    process.exit(0);
  }
  startGitHubApp();
}
