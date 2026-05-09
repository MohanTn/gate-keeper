/**
 * Shared MCP response helper.
 *
 * Every handler module imports this rather than defining its own,
 * so the build doesn't ship the same tiny function in multiple chunks.
 */

export function text(content: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text: content }] };
}
