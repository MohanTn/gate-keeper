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
import {
  ReplGraph, computeDegreeCentrality, findSurprising,
  suggestQuestions, findPath,
} from './repl-algorithms';

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

// Alias for backward compatibility within this file
type GraphData = ReplGraph;

// ── REPL query patterns ────────────────────────────────────

export const QUERY_PATTERNS: Array<{
  name: string; desc: string; match: RegExp;
  handler: (m: RegExpExecArray, graph: GraphData, repo: string) => string;
}> = [
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
    handler: (_, graph) => {
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

// ── REPL command helpers ───────────────────────────────────

function printHelp(): void {
  process.stdout.write('\n  Natural language queries:\n');
  for (const p of QUERY_PATTERNS) process.stdout.write(`    ${p.desc}\n`);
  process.stdout.write('  Commands:\n');
  process.stdout.write('    explain <file>  — detailed file explanation\n');
  process.stdout.write('    path <a> <b>    — shortest dependency path\n');
  process.stdout.write('    refresh         — reload the graph from the daemon\n');
  process.stdout.write('    help            — this message\n');
  process.stdout.write('    quit / exit     — leave the REPL\n\n');
}

export function handleExplain(target: string, graph: GraphData, repo: string): void {
  if (!target) {
    process.stdout.write('No file specified.\n');
    return;
  }
  const match = graph.nodes.find(n =>
    n.id.toLowerCase().includes(target.toLowerCase()) ||
    n.label.toLowerCase().includes(target.toLowerCase())
  );
  if (!match) {
    process.stdout.write(`No file matching "${target}" found in graph.\n`);
    return;
  }
  const rel = path.relative(repo, match.id);
  const errors = match.violations.filter(v => v.severity === 'error').length;
  const warnings = match.violations.filter(v => v.severity === 'warning').length;
  process.stdout.write(`\n  ${rel}\n`);
  process.stdout.write(`  Rating: ${match.rating}/10 | LOC: ${match.metrics.linesOfCode} | Complexity: ${match.metrics.cyclomaticComplexity}\n`);
  process.stdout.write(`  Imports: ${match.metrics.importCount} | Errors: ${errors} | Warnings: ${warnings}\n`);
}

export function handlePath(parts: string[], graph: GraphData, repo: string): void {
  if (parts.length < 2) {
    process.stdout.write('Usage: path <source-file> <target-file>\n');
    return;
  }
  const a = parts[0] as string;
  const b = parts[1] as string;
  const src = graph.nodes.find(n => n.label.includes(a) || n.id.includes(a));
  const dst = graph.nodes.find(n => n.label.includes(b) || n.id.includes(b));
  if (!src || !dst) {
    process.stdout.write(`Could not find matching files. Try: ${graph.nodes.slice(0, 10).map(n => n.label).join(', ')}\n`);
    return;
  }
  process.stdout.write(`Path from ${path.relative(repo, src.id)} to ${path.relative(repo, dst.id)}:\n`);
  const found = findPath(src.id, dst.id, graph.edges);
  if (found) {
    for (const f of found) {
      const n = graph.nodes.find(node => node.id === f);
      process.stdout.write(`  ${path.relative(repo, f)} (${n?.rating ?? '?'})\n`);
    }
  } else {
    process.stdout.write('  No dependency path found between these files.\n');
  }
}

// ── Core REPL loop (shared by main() and startRepl()) ─────

async function runRepl(repo: string, graph: GraphData): Promise<void> {
  const repoName = path.basename(repo);
  process.stdout.write(`\n  ⬡ Gate Keeper Query REPL — ${repoName}\n`);
  process.stdout.write(`  ${graph.nodes.length} files, ${graph.edges.length} edges\n\n`);

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
      printHelp();
      rl.prompt();
      return;
    }

    if (trimmed === 'refresh') {
      const freshRaw = await fetchApi(`/api/graph?repo=${encodeURIComponent(repo)}`);
      if (freshRaw) {
        Object.assign(graph, freshRaw);
        process.stdout.write(`Refreshed: ${graph.nodes.length} files, ${graph.edges.length} edges\n`);
      } else {
        process.stdout.write('Refresh failed — daemon may be unavailable\n');
      }
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('explain ')) {
      handleExplain(trimmed.slice(8).trim(), graph, repo);
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('path ')) {
      handlePath(trimmed.slice(5).trim().split(/\s+/), graph, repo);
      rl.prompt();
      return;
    }

    let answered = false;
    for (const p of QUERY_PATTERNS) {
      if (p.match.test(trimmed)) {
        const m = p.match.exec(trimmed);
        if (m) {
          process.stdout.write(p.handler(m, graph, repo) + '\n');
          answered = true;
        }
        break;
      }
    }

    if (!answered) {
      process.stdout.write('Query not recognised. Try: "god nodes", "surprising connections", "health", "suggest questions", or type "help".\n');
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.stdout.write('\nGoodbye.\n');
    process.exit(0);
  });
}

async function loadGraph(repo: string, startupHint: string): Promise<GraphData> {
  const graphRaw = await fetchApi(`/api/graph?repo=${encodeURIComponent(repo)}`);
  if (!graphRaw) {
    process.stderr.write('Error: Cannot connect to Gate Keeper daemon on port 5378.\n');
    process.stderr.write(`${startupHint}\n`);
    process.exit(1);
  }
  return graphRaw as GraphData;
}

// ── Public entry points ────────────────────────────────────

/**
 * Exported for use by the daemon's --query mode.
 * Loads the graph from the running daemon, then starts the REPL.
 */
export async function startRepl(repo: string): Promise<void> {
  const graph = await loadGraph(repo, 'Start the daemon first: npm run dev  (from the gate-keeper directory)');
  await runRepl(repo, graph);
}

async function main() {
  const args = process.argv.slice(2);
  const repoIndex = args.indexOf('--repo');
  const repoArg = repoIndex >= 0 ? args[repoIndex + 1] : undefined;
  const repo = repoArg ?? findGitRoot(process.cwd());
  const graph = await loadGraph(repo, 'Start it with: npm run dev  (from the gate-keeper directory)');
  await runRepl(repo, graph);
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(String(err) + '\n');
    process.exit(1);
  });
}
