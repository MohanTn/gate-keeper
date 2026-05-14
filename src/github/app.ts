/**
 * GitHub App webhook handler skeleton.
 *
 * Listens for push and pull_request webhooks from GitHub, runs graph analysis
 * on changed files, and posts comments with impact data.
 *
 * This is a minimal Express app — configure it via:
 *   EXPOSE_GITHUB_APP=true GK_WEBHOOK_SECRET=<secret> npx tsx src/github/app.ts
 *
 * For full setup:
 *   1. Register a GitHub App at https://github.com/settings/apps
 *   2. Set Webhook URL to http://your-server:5432/webhook
 *   3. Grant push + pull_request events
 *   4. Set EXPOSE_GITHUB_APP=true and GK_WEBHOOK_SECRET
 *   5. Set GITHUB_TOKEN=<app-installation-token>
 */

import express from 'express';
import * as crypto from 'crypto';
import * as http from 'http';
import { formatPRComment, PRFile, GraphNodeSummary } from './commenter';

const PORT = parseInt(process.env['GK_GH_PORT'] ?? '5432', 10);
const WEBHOOK_SECRET = process.env['GK_WEBHOOK_SECRET'] ?? '';
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'] ?? '';
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

function verifySignature(payload: string, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET) return true; // no secret = no verification
  if (!signature) return false;
  const sig = `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(signature));
  } catch {
    return false;
  }
}

function getRepoFullName(payload: Record<string, unknown>): string | null {
  const repo = payload['repository'] as Record<string, unknown> | undefined;
  return repo ? `${repo['owner']}/${repo['name']}` as string : null;
}

function getRepoPath(payload: Record<string, unknown>): string | null {
  const repo = payload['repository'] as Record<string, unknown> | undefined;
  const cloneUrl = repo?.['clone_url'] as string | undefined;
  if (cloneUrl) return cloneUrl;
  return getRepoFullName(payload);
}

// ── Webhook handler ───────────────────────────────────────

async function handlePush(payload: Record<string, unknown>): Promise<void> {
  const repoName = getRepoFullName(payload);
  const commits = (payload['commits'] ?? []) as Array<{ modified?: string[]; added?: string[]; removed?: string[] }>;
  const allFiles = new Set<string>();
  for (const c of commits) {
    for (const f of c.modified ?? []) allFiles.add(f);
    for (const f of c.added ?? []) allFiles.add(f);
  }
  if (allFiles.size === 0 || !repoName) return;

  // Fetch graph data from the local daemon
  const graphRaw = await fetchDaemonApi(`/api/graph`);
  if (!graphRaw) return;

  const graph = graphRaw as { nodes: Array<{ id: string; label: string; rating: number; violations: Array<{ severity: string }> }>; edges: Array<{ source: string; target: string }> };

  // Build summaries for each pushed file
  const summaries: GraphNodeSummary[] = [];
  const filePaths = new Set(graph.nodes.map(n => n.id));

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

  if (summaries.length === 0) return;

  // Format the comment (we don't auto-post — the caller provides transport)
  const pr = {
    number: 0, title: `Push to ${(payload['ref'] as string) ?? 'unknown'}`,
    author: (payload['pusher'] as Record<string, string>)?.['name'] ?? 'unknown',
    baseBranch: (payload['ref'] as string)?.replace('refs/heads/', '') ?? '',
    headBranch: (payload['ref'] as string)?.replace('refs/heads/', '') ?? '',
  };
  const comment = formatPRComment(pr, summaries, repoName, graph.nodes.length);
  console.error(`[gate-keeper-github] Push analysis: ${summaries.length} files changed, verdict=${comment.verdict}`);
  for (const s of summaries) {
    console.error(`[gate-keeper-github]   ${s.path}: ${s.rating}/10, ${s.fragileDependents} fragile`);
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
      const payload = req.body as Record<string, unknown>;
      if (event === 'push') {
        await handlePush(payload).catch(err => {
          console.error(`[gate-keeper-github] Push handler error: ${err instanceof Error ? err.message : String(err)}`);
        });
      } else if (event === 'pull_request') {
        const action = payload['action'] as string;
        if (action === 'opened' || action === 'synchronize') {
          console.error(`[gate-keeper-github] PR ${payload['number']} ${action} — analysis triggered`);
        }
      }
    } catch (err) {
      console.error(`[gate-keeper-github] Webhook error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, app: 'gate-keeper-github' });
  });

  app.listen(PORT, () => {
    console.error(`[gate-keeper-github] Webhook server on :${PORT} (secret: ${WEBHOOK_SECRET ? 'set' : 'NOT SET'})`);
  });
}

if (require.main === module) {
  if (!process.env['EXPOSE_GITHUB_APP']) {
    console.error('Set EXPOSE_GITHUB_APP=true to start the GitHub App webhook server.');
    process.exit(0);
  }
  startGitHubApp();
}
