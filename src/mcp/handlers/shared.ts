/**
 * Shared MCP response helpers.
 *
 * `text()` builds a markdown-only response (used for errors and legacy handlers).
 * `envelope()` builds a dual response: markdown for humans + structuredContent
 * for autonomous agents. Per MCP spec rev 2025-03-26 — older clients ignore the
 * extra field and continue parsing content[0].text.
 */

import { AgentResponseEnvelope } from '../../types';

export interface McpResponse {
  content: Array<{ type: string; text: string }>;
  structuredContent?: AgentResponseEnvelope;
  isError?: boolean;
}

export function text(content: string): McpResponse {
  return { content: [{ type: 'text', text: content }] };
}

export function envelope<T>(tool: string, data: T, markdown: string): McpResponse {
  return {
    content: [{ type: 'text', text: markdown }],
    structuredContent: {
      version: '1',
      tool,
      generatedAt: Date.now(),
      data,
    },
  };
}
