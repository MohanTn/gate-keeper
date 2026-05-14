/**
 * Smart cache preload — reads graph data from the daemon at MCP session start
 * so the first 3-5 queries have zero latency.
 *
 * The preloader fetches the full dependency graph and key metrics, then caches
 * them in memory. Subsequent queries read from this cache instead of hitting
 * the daemon (HTTP round-trip).
 */

import * as http from 'http';

const DAEMON_PORT = 5378;
const DEFAULT_REPO = process.cwd();

export interface PreloadedData {
  graph: unknown | null;
  status: { overallRating?: number } | null;
  cycles: unknown[] | null;
  loadedAt: number;
  repo: string;
}

let cached: PreloadedData | null = null;

function fetchApi(urlPath: string): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${DAEMON_PORT}${urlPath}`, { timeout: 3000 }, (res) => {
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

/**
 * Preload graph data for `repo`. Returns the cached data.
 * Subsequent calls return the cached data without re-fetching.
 */
export async function preloadForRepo(repo: string): Promise<PreloadedData> {
  if (cached && cached.repo === repo) return cached;

  const repoEncoded = encodeURIComponent(repo);
  const [graph, status, cycles] = await Promise.all([
    fetchApi(`/api/graph?repo=${repoEncoded}`),
    fetchApi(`/api/status?repo=${repoEncoded}`),
    fetchApi(`/api/cycles?repo=${repoEncoded}`),
  ]);

  cached = {
    graph,
    status: status as PreloadedData['status'],
    cycles: cycles as unknown[],
    loadedAt: Date.now(),
    repo,
  };
  return cached;
}

/**
 * Invalidate the cached preload so the next call re-fetches.
 */
export function invalidatePreload(): void {
  cached = null;
}

/** Check if preloaded data exists and is fresh (< 5 minutes old). */
export function isPreloaded(repo: string): boolean {
  if (!cached || cached.repo !== repo) return false;
  return (Date.now() - cached.loadedAt) < 5 * 60 * 1000;
}
