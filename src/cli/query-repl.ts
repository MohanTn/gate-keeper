#!/usr/bin/env node
/**
 * --query interactive REPL mode
 *
 * Starts a readline loop accepting natural language queries against the loaded
 * dependency graph.
 *
 * Usage:
 *   npx tsx src/cli/query-repl.ts [--repo /path/to/repo]
 *
 * Queries are dispatched through the same deterministic pattern matcher used by
 * the MCP `query_graph` tool — no LLM involved, purely graph-algorithm answers.
 *
 * Commands:
 *   query text    — ask about the graph (god nodes, surprising connections, etc.)
 *   explain path  — get detailed explanation of a file
 *   path src dst  — shortest dependency path between two files
 *   help          — show available query patterns
 *   quit / exit   — leave the REPL
 */

import * as http from 'http';
import * as path from 'path';
import * as readline from 'readline';
import { spawnSync } from 'child_process';

const DAEMON_PORT = 5378;

// ── Helpers ────────────────────────────────────────────────

function fetchApi(urlPath: string): Promise<unknown> {
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

function findGitRoot(dir: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf8', timeout: 3000,
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : dir;
}

function getModule(filePath: string, repoRoot: string): string {
  const rel = path.relative(repoRoot, filePath);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length <= 1) return '(root)';
  if (['src', 'lib', 'app'].includes(parts[0]!) && parts.length > 2) return parts[1]!;
  return parts[0]!;
}

// ── Pattern matchers (same logic as query_graph handler) ──

interface GraphData {
  nodes: Array<{ id: string; label: string; rating: number; metrics: { linesOfCode: number; importCount: number; cyclomaticComplexity: number }; violations: Array<{ type: string; severity: string }> }>;
  edges: Array<{ source: string; target: string; type: string; strength: number }>;
}

function computeDegreeCentrality(graph: GraphData) {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const n of graph.nodes) { inDeg.set(n.id, 0); outDeg.set(n.id, 0); }
  for (const e of graph.edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  return graph.nodes.map(n => ({
    path: n.id, label: n.label, rating: n.rating,
    inDegree: inDeg.get(n.id) ?? 0,
    outDegree: outDeg.get(n.id) ?? 0,
    totalDegree: (inDeg.get(n.id) ?? 0) + (outDeg.get(n.id) ?? 0),
  })).sort((a, b) => b.totalDegree - a.totalDegree);
}

function findSurprising(graph: GraphData, repo: string, topN = 5) {
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const moduleOf = new Map<string, string>();
  for (const n of graph.nodes) moduleOf.set(n.id, getModule(n.id, repo));

  const pairCounts = new Map<string, number>();
  for (const e of graph.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const sm = moduleOf.get(e.source) ?? '(?)';
    const tm = moduleOf.get(e.target) ?? '(?)';
    if (sm !== tm) {
      const key = `${sm}→${tm}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }

  const results: Array<{ src: string; dst: string; S: string; T: string; score: number }> = [];
  for (const e of graph.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const sm = moduleOf.get(e.source) ?? '(?)';
    const tm = moduleOf.get(e.target) ?? '(?)';
    if (sm === tm) continue;
    const pairCount = pairCounts.get(`${sm}→${tm}`) ?? 1;
    const score = 1 / Math.log(pairCount + 1);
    results.push({ src: e.source, dst: e.target, S: sm, T: tm, score });
  }

  const seen = new Set<string>();
  return results.sort((a, b) => b.score - a.score).filter(r => {
    const k = `${r.src}|${r.dst}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, topN);
}

function suggestQuestions(graph: GraphData, repo: string): string[] {
  const centrality = computeDegreeCentrality(graph);
  const top = centrality.slice(0, 3);
  const worst = [...graph.nodes].sort((a, b) => a.rating - b.rating)[0];
  const qs: string[] = [];
  for (const god of top) {
    qs.push(`What would break if "${path.relative(repo, god.path)}" changed?`);
  }
  if (worst && top[0] && worst.id !== top[0].path) {
    qs.push(`How does "${path.relative(repo, top[0].path)}" connect to "${path.relative(repo, worst.id)}" (worst-rated file)?`);
  }
  if (worst && worst.rating < 7) {
    qs.push(`What's wrong with "${path.relative(repo, worst.id)}" (rating ${worst.rating}/10)?`);
  }
  return qs;
}

// ── REPL ──────────────────────────────────────────────────

const QUERY_PATTERNS: Array<{ name: string; desc: string; match: RegExp; handler: (m: RegExpExecArray, graph: GraphData, repo: string) => string }> = [
  {
    name: 'god nodes',
    desc: 'most-connected files (highest blast radius)',
    match: /god|hotspot|central|blast|connected/i,
    handler: (_, graph, repo) => {
      const ranked = computeDegreeCentrality(graph).slice(0, 8);
      return ranked.length === 0 ? 'No files in graph.' :
        ranked.map((n, i) => `${i + 1}. ${path.relative(repo, n.path)} — ${n.totalDegree} connections, rating ${n.rating}/10`).join('\n');
    },
  },
  {
    name: 'surprising',
    desc: 'cross-module dependencies',
    match: /surprising|unexpected|cross|strange/i,
    handler: (_, graph, repo) => {
      const s = findSurprising(graph, repo, 5);
      if (s.length === 0) return 'No surprising cross-module connections found.';
      return s.map((c, i) => `${i + 1}. ${path.relative(repo, c.src)} → ${path.relative(repo, c.dst)} (${c.S} → ${c.T})`).join('\n');
    },
  },
  {
    name: 'questions / suggestions',
    desc: 'auto-generated questions about the codebase',
    match: /question|suggest|recommend/i,
    handler: (_, graph, repo) => {
      const qs = suggestQuestions(graph, repo);
      return qs.map((q, i) => `${i + 1}. ${q}`).join('\n');
    },
  },
  {
    name: 'health / quality',
    desc: 'worst-rated files and overall quality',
    match: /health|quality|worst|bad|poor|rating/i,
    handler: (_, graph, _repo) => {
      if (graph.nodes.length === 0) return 'No files in graph.';
      const avg = graph.nodes.reduce((s, n) => s + n.rating, 0) / graph.nodes.length;
      const worst = [...graph.nodes].sort((a, b) => a.rating - b.rating).slice(0, 5);
      const lines = [`Overall: ${graph.nodes.length} files, avg rating ${avg.toFixed(1)}/10`];
      for (const n of worst) {
        const errors = n.violations.filter(v => v.severity === 'error').length;
        const warnings = n.violations.filter(v => v.severity === 'warning').length;
        lines.push(`  ${n.rating}/10 — ${n.label} (${errors} errors, ${warnings} warnings)`);
      }
      return lines.join('\n');
    },
  },
];

async function main() {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf('--repo');
  const repo = repoIndex >= 0 ? args[repoIndex + 1] : findGitRoot(process.cwd());

  // Load graph
  const graphRaw = await fetchApi(`/api/graph?repo=${encodeURIComponent(repo)}`);
  if (!graphRaw) {
    console.error('Error: Cannot connect to Gate Keeper daemon on port 5378.');
    console.error('Start it with: npm run dev  (from the gate-keeper directory)');
    process.exit(1);
  }
  const graph = graphRaw as GraphData;
  const repoName = path.basename(repo);
  console.log(`\n  ⬡ Gate Keeper Query REPL — ${repoName}`);
  console.log(`  ${graph.nodes.length} files, ${graph.edges.length} edges\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'gk> ',
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();

    if (!trimmed) { rl.prompt(); return; }
    if (trimmed === 'quit' || trimmed === 'exit') { rl.close(); return; }

    if (trimmed === 'help') {
      console.log('\n  Natural language queries:');
      for (const p of QUERY_PATTERNS) {
        console.log(`    ${p.desc}`);
      }
      console.log('  Commands:');
      console.log('    explain <file>  — detailed file explanation');
      console.log('    path <a> <b>    — shortest dependency path');
      console.log('    refresh         — reload the graph from the daemon');
      console.log('    help            — this message');
      console.log('    quit / exit     — leave the REPL\n');
      rl.prompt();
      return;
    }

    if (trimmed === 'refresh') {
      const freshRaw = await fetchApi(`/api/graph?repo=${encodeURIComponent(repo)}`);
      if (freshRaw) {
        Object.assign(graph, freshRaw);
        console.log(`Refreshed: ${graph.nodes.length} files, ${graph.edges.length} edges`);
      } else {
        console.log('Refresh failed — daemon may be unavailable');
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('explain ')) {
      const target = trimmed.slice(8).trim();
      const match = graph.nodes.find(n =>
        n.id.toLowerCase().includes(target.toLowerCase()) ||
        n.label.toLowerCase().includes(target.toLowerCase())
      );
      if (!match) {
        console.log(`No file matching "${target}" found in graph.`);
      } else {
        const rel = path.relative(repo, match.id);
        const errors = match.violations.filter(v => v.severity === 'error').length;
        const warnings = match.violations.filter(v => v.severity === 'warning').length;
        console.log(`\n  ${rel}`);
        console.log(`  Rating: ${match.rating}/10 | LOC: ${match.metrics.linesOfCode} | Complexity: ${match.metrics.cyclomaticComplexity}`);
        console.log(`  Imports: ${match.metrics.importCount} | Errors: ${errors} | Warnings: ${warnings}`);
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('path ')) {
      const parts = trimmed.slice(5).trim().split(/\s+/);
      if (parts.length < 2) {
        console.log('Usage: path <source-file> <target-file>');
      } else {
        const [a, b] = parts;
        // Match by filename
        const src = graph.nodes.find(n => n.label.includes(a) || n.id.includes(a));
        const dst = graph.nodes.find(n => n.label.includes(b) || n.id.includes(b));
        if (!src || !dst) {
          console.log(`Could not find matching files. Try: ${graph.nodes.slice(0, 10).map(n => n.label).join(', ')}`);
        } else {
          console.log(`Path from ${path.relative(repo, src.id)} to ${path.relative(repo, dst.id)}:`);
          // BFS
          const queue: Array<{ id: string; trail: string[] }> = [{ id: src.id, trail: [src.id] }];
          const visited = new Set([src.id]);
          let found: string[] | null = null;
          while (queue.length > 0) {
            const { id, trail } = queue.shift()!;
            for (const edge of graph.edges.filter(e => e.source === id)) {
              if (visited.has(edge.target)) continue;
              const nt = [...trail, edge.target];
              if (edge.target === dst.id) { found = nt; break; }
              visited.add(edge.target);
              queue.push({ id: edge.target, trail: nt });
            }
            if (found) break;
          }
          if (found) {
            found.forEach(f => {
              const n = graph.nodes.find(n => n.id === f);
              console.log(`  ${path.relative(repo, f)} (${n?.rating ?? '?'})`);
            });
          } else {
            console.log('  No dependency path found between these files.');
          }
        }
      }
      rl.prompt();
      return;
    }

    // NL pattern matching
    let answered = false;
    for (const p of QUERY_PATTERNS) {
      if (p.match.test(trimmed)) {
        const m = p.match.exec(trimmed);
        if (m) {
          console.log(p.handler(m, graph, repo));
          answered = true;
        }
        break;
      }
    }

    if (!answered) {
      console.log('Query not recognised. Try: "god nodes", "surprising connections", "health", "suggest questions", or type "help".');
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye.');
    process.exit(0);
  });
}

/**
 * Exported for use by the daemon's --query mode.
 * Loads the graph from the running daemon, then starts the REPL.
 */
export async function startRepl(repo: string): Promise<void> {
  const graphRaw = await fetchApi(`/api/graph?repo=${encodeURIComponent(repo)}`);
  if (!graphRaw) {
    console.error('Error: Cannot connect to Gate Keeper daemon on port 5378.');
    console.error('Start the daemon first: npm run dev  (from the gate-keeper directory)');
    process.exit(1);
  }
  const graph = graphRaw as GraphData;
  const repoName = path.basename(repo);
  console.log(`\n  ⬡ Gate Keeper Query REPL — ${repoName}`);
  console.log(`  ${graph.nodes.length} files, ${graph.edges.length} edges\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'gk> ',
  });

  // Re-invoke the REPL loop wiring graph/repo into scope
  rl.prompt();

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();

    if (!trimmed) { rl.prompt(); return; }
    if (trimmed === 'quit' || trimmed === 'exit') { rl.close(); return; }

    if (trimmed === 'help') {
      console.log('\n  Natural language queries:');
      for (const p of QUERY_PATTERNS) console.log(`    ${p.desc}`);
      console.log('  Commands:');
      console.log('    explain <file>  — detailed file explanation');
      console.log('    path <a> <b>    — shortest dependency path');
      console.log('    refresh         — reload the graph from the daemon');
      console.log('    help            — this message');
      console.log('    quit / exit     — leave the REPL\n');
      rl.prompt();
      return;
    }

    if (trimmed === 'refresh') {
      const freshRaw = await fetchApi(`/api/graph?repo=${encodeURIComponent(repo)}`);
      if (freshRaw) {
        Object.assign(graph, freshRaw);
        console.log(`Refreshed: ${graph.nodes.length} files, ${graph.edges.length} edges`);
      } else {
        console.log('Refresh failed — daemon may be unavailable');
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('explain ')) {
      const target = trimmed.slice(8).trim();
      const match = graph.nodes.find(n =>
        n.id.toLowerCase().includes(target.toLowerCase()) ||
        n.label.toLowerCase().includes(target.toLowerCase())
      );
      if (!match) {
        console.log(`No file matching "${target}" found in graph.`);
      } else {
        const rel = path.relative(repo, match.id);
        const errors = match.violations.filter(v => v.severity === 'error').length;
        const warnings = match.violations.filter(v => v.severity === 'warning').length;
        console.log(`\n  ${rel}`);
        console.log(`  Rating: ${match.rating}/10 | LOC: ${match.metrics.linesOfCode} | Complexity: ${match.metrics.cyclomaticComplexity}`);
        console.log(`  Imports: ${match.metrics.importCount} | Errors: ${errors} | Warnings: ${warnings}`);
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('path ')) {
      const parts = trimmed.slice(5).trim().split(/\s+/);
      if (parts.length < 2) {
        console.log('Usage: path <source-file> <target-file>');
      } else {
        const [a, b] = parts;
        const src = graph.nodes.find(n => n.label.includes(a) || n.id.includes(a));
        const dst = graph.nodes.find(n => n.label.includes(b) || n.id.includes(b));
        if (!src || !dst) {
          console.log(`Could not find matching files. Try: ${graph.nodes.slice(0, 10).map(n => n.label).join(', ')}`);
        } else {
          console.log(`Path from ${path.relative(repo, src.id)} to ${path.relative(repo, dst.id)}:`);
          const queue: Array<{ id: string; trail: string[] }> = [{ id: src.id, trail: [src.id] }];
          const visited = new Set([src.id]);
          let found: string[] | null = null;
          while (queue.length > 0) {
            const { id, trail } = queue.shift()!;
            for (const edge of graph.edges.filter(e => e.source === id)) {
              if (visited.has(edge.target)) continue;
              const nt = [...trail, edge.target];
              if (edge.target === dst.id) { found = nt; break; }
              visited.add(edge.target);
              queue.push({ id: edge.target, trail: nt });
            }
            if (found) break;
          }
          if (found) {
            found.forEach(f => {
              const n = graph.nodes.find(n => n.id === f);
              console.log(`  ${path.relative(repo, f)} (${n?.rating ?? '?'})`);
            });
          } else {
            console.log('  No dependency path found between these files.');
          }
        }
      }
      rl.prompt();
      return;
    }

    // NL pattern matching
    let answered = false;
    for (const p of QUERY_PATTERNS) {
      if (p.match.test(trimmed)) {
        const m = p.match.exec(trimmed);
        if (m) {
          console.log(p.handler(m, graph, repo));
          answered = true;
        }
        break;
      }
    }

    if (!answered) {
      console.log('Query not recognised. Try: "god nodes", "surprising connections", "health", "suggest questions", or type "help".');
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye.');
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
