/**
 * Gate Keeper — MCP Server
 *
 * Exposes code-quality analysis as MCP tools that AI agents (GitHub Copilot,
 * Claude, etc.) call after file edits. The agent sees the rating, violations,
 * and codebase health, then self-corrects until quality reaches the threshold.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard transport).
 *
 * Run: npx tsx src/mcp/server.ts
 *      node dist/mcp/server.js
 */

import { handleToolCall as handleTool } from './handlers';

// ── Tool definitions ───────────────────────────────────────

export const TOOLS = [
  {
    name: 'analyze_file',
    description:
      'Analyze a source file on disk for code quality. Returns a rating (0–10), violations, and metrics. ' +
      'Call this after editing a file to verify quality. If the rating is below the threshold, fix the violations and re-analyze.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the source file to analyze (.ts, .tsx, .jsx, .js, .cs)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'analyze_code',
    description:
      'Analyze a code snippet in-memory (no file on disk needed). ' +
      'Useful for checking code quality before writing it to a file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'The source code to analyze' },
        language: {
          type: 'string',
          enum: ['typescript', 'tsx', 'jsx', 'csharp'],
          description: 'Programming language of the code',
        },
      },
      required: ['code', 'language'],
    },
  },
  {
    name: 'get_codebase_health',
    description:
      'Scan a directory and return overall codebase quality: average rating, file count, ' +
      'worst-rated files, and common violation types. Defaults to the current git repository root.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to scan (defaults to git root or cwd)',
        },
        max_files: {
          type: 'number',
          description: 'Maximum files to analyze (default 200)',
        },
      },
    },
  },
  {
    name: 'get_quality_rules',
    description:
      'Return the quality rules, thresholds, and scoring deductions Gate Keeper enforces. ' +
      'Read this first so you understand what to avoid when writing code.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_file_context',
    description:
      'Get rich context for a file: its dependencies (imports), reverse dependencies (files that import it), ' +
      'circular dependency cycles it participates in, rating trend over time, and a detailed rating breakdown. ' +
      'Use this after analyze_file to understand a file\'s role in the codebase and the impact of changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of file_path)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_dependency_graph',
    description:
      'Return the dependency graph for the repository: all analyzed files as nodes (with ratings, metrics, violations) ' +
      'and edges (import/inheritance relationships). Use this to understand the architecture, find tightly coupled modules, ' +
      'and identify structural issues before making changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of cwd)',
        },
      },
    },
  },
  {
    name: 'get_impact_analysis',
    description:
      'Analyze the impact radius of a file change: find all files that directly or transitively depend on the given file. ' +
      'Use this before editing a widely-imported module to understand which files may be affected.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file being changed',
        },
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of file_path)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'suggest_refactoring',
    description:
      'Analyze a file and return a ranked list of concrete refactoring hints: ' +
      'pattern name, rationale, step-by-step instructions, and estimated rating gain. ' +
      'Use this when a file has violations to understand the highest-impact improvements.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the source file to analyze (.ts, .tsx, .jsx, .js, .cs)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'predict_impact_with_remediation',
    description:
      'Find all files that transitively depend on the given file (blast radius), ' +
      'then for each at-risk dependent (rating < 6) provide targeted fix instructions. ' +
      'Use this before changing a widely-imported module.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file being changed',
        },
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of file_path)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'analyze_many',
    description:
      'Analyze a batch of source files in one MCP call. Returns FileAnalysis[] plus a `fixOrder` array — ' +
      'a topologically sorted list (leaves first) so an autonomous agent can fix dependencies before dependents.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_paths: {
          type: 'array',
          description: 'Absolute paths to source files to analyze in parallel',
          items: { type: 'string' },
        },
        max_parallel: {
          type: 'number',
          description: 'Maximum concurrent analyzers (default 4)',
        },
      },
      required: ['file_paths'],
    },
  },
  {
    name: 'get_violation_patterns',
    description:
      'Return a ranked table of violation patterns across the entire codebase: ' +
      'which violation types appear most, how many files they affect, ' +
      'the total estimated rating gain if fixed, and a module-wide fix suggestion. ' +
      'Use this to plan a codebase cleanup sprint.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'Repository root path (defaults to git root of cwd)',
        },
      },
    },
  },
  // ── Graphify: token-efficient graph-aware tools ───────────
  {
    name: 'get_impact_set',
    description:
      'Depth-bounded BFS over the reverse dependency graph: returns the minimal set of files ' +
      'affected by changing file_path. Each entry includes severity (direct/indirect), rating, and ' +
      'fragility flag (rating<6). ~100 tokens vs. reading every affected file (~5000 tokens each). ' +
      'Use this BEFORE editing any file to understand blast radius.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file being changed' },
        depth: { type: 'number', description: 'Maximum hops to traverse (default 2, max 5)' },
        repo: { type: 'string', description: 'Repository root (defaults to git root of file_path)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_centrality_rank',
    description:
      'Return the most-connected nodes in the dependency graph ranked by total degree ' +
      '(in-degree + out-degree). High in-degree = many files depend on this (dangerous to break). ' +
      'High out-degree = this file has many dependencies (fragile itself). ' +
      'Use at session start to know which files require extra care.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Number of top nodes to return (default 10, max 50)' },
        repo: { type: 'string', description: 'Repository root (defaults to git root of cwd)' },
      },
    },
  },
  {
    name: 'trace_path',
    description:
      'Find the shortest import/dependency path between two files using BFS. ' +
      'Reveals coupling chains and fragile bottlenecks on the path. ' +
      'Use this to understand why a change in one file affects another.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'Absolute path to the source file' },
        target: { type: 'string', description: 'Absolute path to the target file' },
        repo: { type: 'string', description: 'Repository root (defaults to git root of source)' },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'summarize_file',
    description:
      'Return a structured summary of a file: rating, metrics, imports list, dependents list, ' +
      'and violation counts — without returning raw file content. ' +
      'Replaces reading the file for context purposes (~300 tokens vs. 5000+ for a full read). ' +
      'Use before editing a file you have not read yet.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        repo: { type: 'string', description: 'Repository root (defaults to git root of file_path)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'find_callers',
    description:
      'Search for all call sites of a function or symbol across files already in the dependency graph. ' +
      'Returns file, line number, snippet, and whether the caller is a test. ' +
      'Use before renaming or removing a function to understand its usage surface.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol_name: { type: 'string', description: 'Function or symbol name to search for' },
        repo: { type: 'string', description: 'Repository root (defaults to git root of cwd)' },
      },
      required: ['symbol_name'],
    },
  },
  {
    name: 'check_pre_edit_safety',
    description:
      'Pre-edit safety gate: assesses the risk of changing a file by combining impact set analysis ' +
      'with fragility scoring. Returns a verdict (safe / warn / block), reason, and suggestions. ' +
      'Call this before editing any widely-imported file. ' +
      'Verdict "block" means 3+ fragile direct dependents — fix those first.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file you plan to change' },
        change_description: { type: 'string', description: 'Brief description of the intended change' },
        repo: { type: 'string', description: 'Repository root (defaults to git root of file_path)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_session_metrics',
    description:
      'Return cumulative token efficiency metrics for this MCP session: total graph queries made, ' +
      'estimated files not read, estimated token savings vs. naive file-read approach, ' +
      'and a per-tool breakdown. Use at end of session to report efficiency gains.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  // ── Knowledge graph intelligence tools ────────────────────
  {
    name: 'get_graph_report',
    description:
      'Generate a narrative Markdown knowledge-graph report: god nodes (highest centrality), ' +
      'surprising cross-module connections, auto-generated suggested questions, and an architecture ' +
      'overview table by module. Call once per session to orient yourself to the codebase.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository root (defaults to git root of cwd)' },
      },
    },
  },
  {
    name: 'query_graph',
    description:
      'Natural-language graph query dispatcher. Recognises patterns like ' +
      '"what would break if X changed", "what connects X to Y", "explain X", ' +
      '"what are the god nodes", "surprising connections". ' +
      'Dispatches to the appropriate graph algorithm and returns a compact answer. ' +
      'No LLM involved — purely deterministic pattern matching over the graph.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural language question about the codebase graph' },
        repo: { type: 'string', description: 'Repository root (defaults to git root of cwd)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'explain_node',
    description:
      'Deep explanation of a file\'s role in the architecture: centrality rank, impact set, ' +
      'surprising connections it participates in, and 3 suggested follow-up questions. ' +
      'Use this instead of reading a file when you need architectural context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file to explain' },
        repo: { type: 'string', description: 'Repository root (defaults to git root of file_path)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'export_graph',
    description:
      'Export the dependency graph in a structured format for external tools. ' +
      'json = graphify-compatible (with god nodes, surprising connections, suggested questions). ' +
      'graphml = standard XML for Gephi/yEd. ' +
      'neo4j = Cypher CREATE statements for import into a Neo4j database.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        format: {
          type: 'string',
          enum: ['json', 'graphml', 'neo4j', 'svg'],
          description: 'Export format (default: json). svg = circular-layout vector image.',
        },
        repo: { type: 'string', description: 'Repository root (defaults to git root of cwd)' },
      },
    },
  },
  {
    name: 'merge_graphs',
    description:
      'Union-merge the dependency graphs of two repositories. ' +
      'Nodes present in both are deduplicated; conflicting ratings are resolved by taking the minimum ' +
      '(conservative). Returns the merged graph and a list of resolved conflicts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo_a: { type: 'string', description: 'Absolute path to the first repository' },
        repo_b: { type: 'string', description: 'Absolute path to the second repository' },
      },
      required: ['repo_a', 'repo_b'],
    },
  },
  // ── Platform integration tools ────────────────────────────
  {
    name: 'install_platform',
    description:
      'Write AI assistant integration config for this repository. ' +
      'claude-code → appends session protocol to CLAUDE.md. ' +
      'copilot → creates .github/copilot-instructions.md. ' +
      'cursor → creates .cursorrules. ' +
      'vscode → creates .vscode/mcp.json. ' +
      'github-action → creates .github/workflows/gate-keeper.yml.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: ['claude-code', 'copilot', 'cursor', 'vscode', 'github-action'],
          description: 'Target AI platform',
        },
        repo: { type: 'string', description: 'Repository root to install into (defaults to git root of cwd)' },
        force: { type: 'boolean', description: 'Overwrite existing file (default false)' },
        gate_keeper_path: { type: 'string', description: 'Path to gate-keeper installation (defaults to current install)' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'install_git_hooks',
    description:
      'Install post-commit and post-checkout git hooks that automatically re-analyze changed files ' +
      'after each commit or branch switch. Hooks are non-blocking and will not slow git operations. ' +
      'Also outputs the .gitattributes entry and git config snippet for the graph.json merge driver.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository root to install hooks into (defaults to git root of cwd)' },
        force: { type: 'boolean', description: 'Overwrite existing hooks (default false)' },
        gate_keeper_path: { type: 'string', description: 'Path to gate-keeper installation' },
      },
    },
  },
  {
    name: 'get_graph_viz',
    description:
      'Generate a standalone interactive HTML visualization of the dependency graph and write it to disk. ' +
      'The file is self-contained (no CDN) with force-directed layout, pan/zoom, search, ' +
      'node click detail panel, and rating-colour coding. ' +
      'Returns the output file path so you can open it in a browser.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Repository root (defaults to git root of cwd)' },
        output_path: {
          type: 'string',
          description: 'Where to write the HTML file (default: ~/.gate-keeper/graph-viz.html)',
        },
      },
    },
  },
  {
    name: 'pr_review',
    description:
      'Risk-score a set of changed files against the dependency graph. ' +
      'Each file gets GREEN (safe), YELLOW (review carefully), or RED (request changes). ' +
      'RED = low quality rating OR god node with fragile dependents. ' +
      'Pass changed_files[] explicitly, or omit to auto-detect via `git diff HEAD~1 HEAD`.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        changed_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of changed file paths (absolute or relative to repo). Defaults to git diff HEAD~1.',
        },
        repo: { type: 'string', description: 'Repository root (defaults to git root of cwd)' },
      },
    },
  },
];

// ── JSON-RPC / MCP protocol ───────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Send JSON-RPC response to stdout */
export function send(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

/** Send successful result */
export function sendResult(id: number | string | null, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

/** Send error response */
export function sendError(id: number | string | null, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/** Handle incoming JSON-RPC message */
export async function handleMessage(msg: JsonRpcRequest): Promise<void> {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      sendResult(id ?? null, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'gate-keeper', version: '1.0.0' },
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    case 'tools/list':
      sendResult(id ?? null, { tools: TOOLS });
      break;

    case 'tools/call': {
      const callParams = params as { name?: unknown; arguments?: Record<string, unknown> } | undefined;
      const toolName = String(callParams?.name ?? '');
      const toolArgs = (callParams?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await handleTool(toolName, toolArgs);
        sendResult(id ?? null, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendResult(id ?? null, {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        });
      }
      break;
    }

    case 'ping':
      sendResult(id ?? null, {});
      break;

    default:
      // Ignore unknown notifications (no id), error on unknown requests (with id)
      if (id !== undefined) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
      break;
  }
}

/** Process a line of input from stdin */
export function processLine(line: string, buffer: { current: string }): void {
  buffer.current += line;

  let nlIndex: number;
  while ((nlIndex = buffer.current.indexOf('\n')) !== -1) {
    const completeLine = buffer.current.substring(0, nlIndex).trim();
    buffer.current = buffer.current.substring(nlIndex + 1);

    if (!completeLine || completeLine.startsWith('Content-Length:')) continue;

    try {
      const msg = JSON.parse(completeLine) as JsonRpcRequest;
      handleMessage(msg).catch(err => {
        process.stderr.write(`[gate-keeper] Handler error: ${err}\n`);
      });
    } catch {
      // Not valid JSON — skip
    }
  }
}

/** Start the MCP server (stdio transport) */
export function startServer(): void {
  const buffer = { current: '' };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer.current += chunk;
    let nlIndex: number;
    while ((nlIndex = buffer.current.indexOf('\n')) !== -1) {
      const line = buffer.current.substring(0, nlIndex).trim();
      buffer.current = buffer.current.substring(nlIndex + 1);
      if (!line || line.startsWith('Content-Length:')) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcRequest;
        handleMessage(msg).catch(err => {
          process.stderr.write(`[gate-keeper] Handler error: ${err}\n`);
        });
      } catch {
        // Not valid JSON — skip
      }
    }
  });

  process.stdin.on('end', () => process.exit(0));
  process.stderr.write('[gate-keeper] MCP server started (stdio)\n');
}

// Only start server when run directly, not when imported for testing
if (require.main === module) {
  startServer();
}
