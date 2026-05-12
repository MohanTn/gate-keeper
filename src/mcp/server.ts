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
