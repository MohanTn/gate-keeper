/**
 * Graph-aware MCP handlers — graphify-style token-efficient queries.
 *
 * Each handler returns a compact structured JSON response instead of prose,
 * allowing agents to understand the impact of a change using 50–300 tokens
 * rather than reading raw files (typically 5 000+ tokens each).
 *
 * Tools:
 *   get_impact_set         — depth-bounded BFS over dependents
 *   get_centrality_rank    — most-connected nodes (high blast-radius files)
 *   trace_path             — shortest import path between two files
 *   summarize_file         — structured file summary (no raw content)
 *   find_callers           — grep-like search for a function/symbol across analyzed files
 *   check_pre_edit_safety  — go/warn/block pre-edit safety assessment
 *   get_session_metrics    — cumulative token savings for this MCP session
 */

import * as path from 'path';
import * as fs from 'fs';
import { fetchDaemonApi, findGitRoot } from '../helpers';
import { GraphResponse, FileDetailResponse } from './types';
import { text, envelope, McpResponse } from './shared';
import { tokenTracker } from '../token-tracker';
import {
  buildAdjacency,
  buildReverseAdjacency,
  getImpactSet,
  tracePath,
  computeCentrality,
} from '../../graph/graph-algorithms';

const FRAGILE_THRESHOLD = 6.0;

// ── Helpers ────────────────────────────────────────────────

function ratingMap(graph: GraphResponse): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of graph.nodes) m.set(n.id, n.rating);
  return m;
}

function daemonError(): McpResponse {
  return text('Error: Gate Keeper daemon is not running. Start it with `npm run daemon` or `npm run dev`.');
}

// ── Handlers ───────────────────────────────────────────────

export async function handleGetImpactSet(args: Record<string, unknown>): Promise<McpResponse> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const depth = Math.min(Number(args.depth ?? 2), 5);
  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedRepo = encodeURIComponent(repo);

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const revAdj = buildReverseAdjacency(graph.edges);
  const ratings = ratingMap(graph);
  const affected = getImpactSet(filePath, revAdj, ratings, depth, FRAGILE_THRESHOLD);

  const fragile = affected.filter(e => e.fragile);
  const riskScore = fragile.length > 0
    ? Math.min(10, Math.round(fragile.length * 2 + (fragile.reduce((s, e) => s + (6 - e.rating), 0) / fragile.length)))
    : 0;

  const lines: string[] = [
    `## Impact Set: ${path.basename(filePath)}`,
    `**Depth:** ${depth} | **Affected:** ${affected.length} files | **Fragile (rating<6):** ${fragile.length} | **Risk Score:** ${riskScore}/10`,
  ];

  if (affected.length > 0) {
    lines.push('', `| Severity | File | Rating | Fragile |`);
    lines.push(`|----------|------|--------|---------|`);
    for (const e of affected.slice(0, 20)) {
      const rel = path.relative(repo, e.path);
      lines.push(`| ${e.severity} | ${rel} | ${e.rating} | ${e.fragile ? '⚠️ yes' : 'no'} |`);
    }
    if (affected.length > 20) lines.push(`... and ${affected.length - 20} more`);
  } else {
    lines.push('', 'No dependents found. This file is a leaf node — safe to change freely.');
  }

  const data = { filePath, depth, affected, riskScore, fragileCount: fragile.length };
  tokenTracker.record('get_impact_set', affected.length, lines.join('\n'));
  return envelope('get_impact_set', data, lines.join('\n'));
}

export async function handleGetCentralityRank(args: Record<string, unknown>): Promise<McpResponse> {
  const limit = Math.min(Number(args.limit ?? 10), 50);
  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const encodedRepo = encodeURIComponent(repo);

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const ranked = computeCentrality(graph.nodes, graph.edges).slice(0, limit);

  const lines: string[] = [
    `## Centrality Rank — Top ${limit} Most-Connected Files`,
    `**Total files:** ${graph.nodes.length} | **Total edges:** ${graph.edges.length}`,
    '',
    `| Rank | File | In | Out | Total | Rating |`,
    `|------|------|----|-----|-------|--------|`,
  ];

  for (let i = 0; i < ranked.length; i++) {
    const e = ranked[i]!;
    const rel = path.relative(repo, e.path);
    lines.push(`| ${i + 1} | ${rel} | ${e.inDegree} | ${e.outDegree} | ${e.totalDegree} | ${e.rating} |`);
  }
  lines.push('', '_High in-degree = many files depend on this (dangerous to break). High out-degree = this file depends on many (fragile itself)._');

  const data = { repo, nodes: ranked };
  tokenTracker.record('get_centrality_rank', graph.nodes.length, lines.join('\n'));
  return envelope('get_centrality_rank', data, lines.join('\n'));
}

export async function handleTracePath(args: Record<string, unknown>): Promise<McpResponse> {
  const source = String(args.source ?? '');
  const target = String(args.target ?? '');
  if (!source || !target) return text('Error: source and target file paths are required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(source)));
  const encodedRepo = encodeURIComponent(repo);

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const adj = buildAdjacency(graph.edges);
  const ratings = ratingMap(graph);
  const found = tracePath(source, target, adj, ratings);

  if (!found) {
    const revAdj = buildReverseAdjacency(graph.edges);
    const reverse = tracePath(target, source, revAdj, ratings);
    if (reverse) {
      const lines = [
        `## Path: ${path.basename(source)} → ${path.basename(target)}`,
        `No forward dependency path. Found reverse path (target imports source, length ${reverse.length - 1}):`,
        reverse.map(e => `${path.relative(repo, e.path)} (${e.rating})`).join(' → '),
      ];
      const data = { source, target, found: false, reversePath: reverse };
      tokenTracker.record('trace_path', 0, lines.join('\n'));
      return envelope('trace_path', data, lines.join('\n'));
    }

    const noPathLines = [
      `## Path: ${path.basename(source)} → ${path.basename(target)}`,
      'No dependency path found between these files. They are architecturally independent.',
    ];
    const data = { source, target, found: false, path: null };
    tokenTracker.record('trace_path', 0, noPathLines.join('\n'));
    return envelope('trace_path', data, noPathLines.join('\n'));
  }

  const bottlenecks = found.filter(e => e.rating < FRAGILE_THRESHOLD);
  const lines: string[] = [
    `## Path: ${path.basename(source)} → ${path.basename(target)}`,
    `**Length:** ${found.length - 1} hops | **Bottlenecks (rating<6):** ${bottlenecks.length}`,
    '',
    found.map(e => `\`${path.relative(repo, e.path)}\` (${e.rating})`).join(' → '),
  ];

  if (bottlenecks.length > 0) {
    lines.push('', '**Fragile nodes on path:**');
    for (const b of bottlenecks) {
      lines.push(`- ${path.relative(repo, b.path)} — rating ${b.rating}/10`);
    }
  }

  const data = { source, target, found: true, path: found, bottlenecks };
  tokenTracker.record('trace_path', 0, lines.join('\n'));
  return envelope('trace_path', data, lines.join('\n'));
}

export async function handleSummarizeFile(args: Record<string, unknown>): Promise<McpResponse> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedFile = encodeURIComponent(filePath);
  const encodedRepo = encodeURIComponent(repo);

  const [graphRaw, detailRaw] = await Promise.all([
    fetchDaemonApi(`/api/graph?repo=${encodedRepo}`),
    fetchDaemonApi(`/api/file-detail?file=${encodedFile}&repo=${encodedRepo}`),
  ]);

  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const detail = detailRaw as FileDetailResponse | null;
  const node = graph.nodes.find(n => n.id === filePath);

  if (!node && !detail?.analysis) {
    return text(`File not analyzed yet. Run \`analyze_file\` on ${filePath} first.`);
  }

  const analysis = detail?.analysis;
  const rating = node?.rating ?? analysis?.rating ?? 0;
  const metrics = node?.metrics ?? analysis?.metrics;
  const violations = node?.violations ?? analysis?.violations ?? [];

  const imports = graph.edges.filter(e => e.source === filePath).map(e => ({
    path: path.relative(repo, e.target),
    type: e.type,
  }));
  const dependents = graph.edges.filter(e => e.target === filePath).map(e => ({
    path: path.relative(repo, e.source),
    rating: graph.nodes.find(n => n.id === e.source)?.rating ?? null,
  }));

  const violationSummary = violations.reduce<Record<string, number>>((acc, v) => {
    acc[v.severity] = (acc[v.severity] ?? 0) + 1;
    return acc;
  }, {});

  const lines: string[] = [
    `## Summary: ${path.basename(filePath)}`,
    `**Rating:** ${rating}/10 | **LOC:** ${metrics?.linesOfCode ?? '?'} | **Complexity:** ${metrics?.cyclomaticComplexity ?? '?'} | **Imports:** ${imports.length} | **Depended on by:** ${dependents.length}`,
  ];

  if (Object.keys(violationSummary).length > 0) {
    const parts = Object.entries(violationSummary).map(([k, v]) => `${v} ${k}(s)`);
    lines.push(`**Violations:** ${parts.join(', ')}`);
  }

  if (imports.length > 0) {
    lines.push('', `**Imports (${imports.length}):** ${imports.map(i => i.path).join(', ')}`);
  }

  if (dependents.length > 0) {
    const fragile = dependents.filter(d => d.rating !== null && d.rating < FRAGILE_THRESHOLD);
    lines.push(`**Used by (${dependents.length}):** ${dependents.map(d => `${d.path}(${d.rating ?? '?'})`).join(', ')}`);
    if (fragile.length > 0) {
      lines.push(`⚠️ **${fragile.length} fragile dependents** (rating<6) — changes here are high-risk`);
    }
  }

  const data = {
    filePath,
    rating,
    metrics,
    imports,
    dependents,
    violationSummary,
    topViolations: violations.slice(0, 5).map(v => ({ type: v.type, severity: v.severity, line: v.line })),
  };

  tokenTracker.record('summarize_file', 1, lines.join('\n'));
  return envelope('summarize_file', data, lines.join('\n'));
}

export async function handleFindCallers(args: Record<string, unknown>): Promise<McpResponse> {
  const symbolName = String(args.symbol_name ?? '');
  if (!symbolName) return text('Error: symbol_name is required.');

  const repo = String(args.repo ?? findGitRoot(process.cwd()));
  const encodedRepo = encodeURIComponent(repo);

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const analyzedFiles = graph.nodes.map(n => n.id);

  // Search for call patterns: symbolName( or symbolName.call( etc.
  const patterns = [
    new RegExp(`\\b${escapeRegex(symbolName)}\\s*\\(`, 'g'),
    new RegExp(`\\.${escapeRegex(symbolName)}\\s*\\(`, 'g'),
  ];

  interface CallerEntry {
    file: string;
    line: number;
    column: number;
    snippet: string;
    isTest: boolean;
  }

  const callers: CallerEntry[] = [];
  const MAX_RESULTS = 50;

  for (const filePath of analyzedFiles) {
    if (callers.length >= MAX_RESULTS) break;
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    const isTest = filePath.includes('.test.') || filePath.includes('.spec.');

    for (let i = 0; i < lines.length && callers.length < MAX_RESULTS; i++) {
      const line = lines[i]!;
      if (patterns.some(p => { p.lastIndex = 0; return p.test(line); })) {
        callers.push({
          file: path.relative(repo, filePath),
          line: i + 1,
          column: line.indexOf(symbolName) + 1,
          snippet: line.trim().slice(0, 120),
          isTest,
        });
      }
    }
  }

  const prodCallers = callers.filter(c => !c.isTest);
  const testCallers = callers.filter(c => c.isTest);

  const mdLines: string[] = [
    `## Callers of \`${symbolName}\``,
    `**Found:** ${callers.length} call site(s) in ${analyzedFiles.length} analyzed files | **Production:** ${prodCallers.length} | **Tests:** ${testCallers.length}`,
  ];

  if (callers.length > 0) {
    mdLines.push('', '| File | Line | Test? | Snippet |');
    mdLines.push('|------|------|-------|---------|');
    for (const c of callers) {
      mdLines.push(`| ${c.file} | ${c.line} | ${c.isTest ? '✓' : ''} | \`${c.snippet}\` |`);
    }
    if (callers.length >= MAX_RESULTS) {
      mdLines.push(`_Results capped at ${MAX_RESULTS}. Refine the symbol name to narrow results._`);
    }
  } else {
    mdLines.push('', `No call sites found for \`${symbolName}\` in analyzed files.`);
  }

  const data = { symbolName, callers, prodCount: prodCallers.length, testCount: testCallers.length };
  tokenTracker.record('find_callers', analyzedFiles.length - callers.length, mdLines.join('\n'));
  return envelope('find_callers', data, mdLines.join('\n'));
}

export async function handleCheckPreEditSafety(args: Record<string, unknown>): Promise<McpResponse> {
  const filePath = String(args.file_path ?? '');
  if (!filePath) return text('Error: file_path is required.');

  const changeDescription = String(args.change_description ?? 'unspecified change');
  const repo = String(args.repo ?? findGitRoot(path.dirname(filePath)));
  const encodedRepo = encodeURIComponent(repo);

  const graphRaw = await fetchDaemonApi(`/api/graph?repo=${encodedRepo}`);
  if (!graphRaw) return daemonError();

  const graph = graphRaw as GraphResponse;
  const revAdj = buildReverseAdjacency(graph.edges);
  const ratings = ratingMap(graph);
  const affected = getImpactSet(filePath, revAdj, ratings, 3, FRAGILE_THRESHOLD);

  const fileNode = graph.nodes.find(n => n.id === filePath);
  const fileRating = fileNode?.rating ?? null;
  const fragile = affected.filter(e => e.fragile);
  const directFragile = fragile.filter(e => e.severity === 'direct');

  let verdict: 'safe' | 'warn' | 'block';
  let reason: string;

  if (fragile.length === 0 && affected.length < 5) {
    verdict = 'safe';
    reason = `Low blast radius (${affected.length} affected files, none fragile).`;
  } else if (directFragile.length >= 3 || fragile.length >= 5) {
    verdict = 'block';
    reason = `${fragile.length} fragile dependents (${directFragile.length} direct). High risk of cascading failures.`;
  } else {
    verdict = 'warn';
    reason = `${fragile.length} fragile dependent(s) — verify after change.`;
  }

  const suggestions: string[] = [];
  if (verdict !== 'safe') {
    if (fileRating !== null && fileRating >= 7) {
      suggestions.push('Source file is healthy — changes are lower risk if interface is preserved.');
    }
    if (fragile.length > 0) {
      suggestions.push(`Fix fragile dependents first: ${fragile.slice(0, 3).map(e => path.basename(e.path)).join(', ')}`);
    }
    suggestions.push('Use `get_impact_set` with depth=1 to see direct dependents only.');
    suggestions.push('Use `summarize_file` on each fragile dependent to understand coupling.');
  }

  const icon = verdict === 'safe' ? '✅' : verdict === 'warn' ? '⚠️' : '🛑';
  const mdLines: string[] = [
    `## Pre-Edit Safety: ${path.basename(filePath)}`,
    `**Change:** ${changeDescription}`,
    `**Verdict:** ${icon} ${verdict.toUpperCase()} — ${reason}`,
    `**File rating:** ${fileRating ?? 'not analyzed'}/10 | **Affected:** ${affected.length} | **Fragile:** ${fragile.length}`,
  ];

  if (suggestions.length > 0) {
    mdLines.push('', '**Suggestions:**');
    suggestions.forEach(s => mdLines.push(`- ${s}`));
  }

  const data = { filePath, changeDescription, verdict, reason, affected, fragileCount: fragile.length, fileRating, suggestions };
  tokenTracker.record('check_pre_edit_safety', affected.length, mdLines.join('\n'));
  return envelope('check_pre_edit_safety', data, mdLines.join('\n'));
}

export function handleGetSessionMetrics(): McpResponse {
  const budget = tokenTracker.getContextBudget();

  const mdLines: string[] = [
    '## Gate Keeper — Context Budget',
    `**Graph queries:** ${budget.totalQueries} | **Files not read:** ${budget.totalFilesNotRead}`,
    `**Estimated naive tokens:** ${budget.estimatedNaiveTokens.toLocaleString()}`,
    `**Actual tokens used:** ${budget.actualResponseTokens.toLocaleString()}`,
    `**Tokens saved:** ${budget.savingsTokens.toLocaleString()} (~${budget.savingsPercent}% reduction)`,
  ];

  if (budget.perTool.length > 0) {
    mdLines.push('', '| Tool | Calls | Files avoided | Tokens saved |');
    mdLines.push('|------|-------|---------------|--------------|');
    for (const t of budget.perTool) {
      mdLines.push(`| ${t.tool} | ${t.calls} | ${t.filesAvoided} | ~${t.tokensSaved.toLocaleString()} |`);
    }
  }

  if (budget.recommendations.length > 0) {
    mdLines.push('', '**Recommendations:**');
    for (const r of budget.recommendations) {
      mdLines.push(`- ${r}`);
    }
  }

  return envelope('get_session_metrics', budget, mdLines.join('\n'));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
