/**
 * MCP Server - JSON-RPC Protocol Tests
 *
 * Tests for the JSON-RPC message handling in server.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  TOOLS,
  handleMessage,
  send,
  sendResult,
  sendError,
  processLine,
  JsonRpcRequest,
  JsonRpcResponse,
} from './server';
import { handleToolCall } from './handlers';

// Mock stdout write to capture responses

describe('MCP Server - JSON-RPC Protocol', () => {
  let capturedOutputs: string[];
  let capturedErrors: string[];
  let tempFilePath: string;

  beforeEach(() => {
    capturedOutputs = [];
    capturedErrors = [];
    tempFilePath = path.join('/tmp', `gate-keeper-protocol-${Date.now()}.ts`);

    // Mock stdout and stderr
    jest.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
      if (typeof data === 'string') {
        capturedOutputs.push(data);
      }
      return true;
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      if (typeof data === 'string') {
        capturedErrors.push(data);
      }
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  });

  describe('Tool Definitions', () => {
    it('should export TOOLS array', () => {
      expect(TOOLS).toBeDefined();
      expect(Array.isArray(TOOLS)).toBe(true);
    });

    it('should have 11 tools', () => {
      expect(TOOLS.length).toBe(11);
    });

    it('should have required tool properties', () => {
      TOOLS.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });

    it('should have all expected tool names', () => {
      const toolNames = TOOLS.map(t => t.name);
      expect(toolNames).toContain('analyze_file');
      expect(toolNames).toContain('analyze_code');
      expect(toolNames).toContain('get_codebase_health');
      expect(toolNames).toContain('get_quality_rules');
      expect(toolNames).toContain('get_file_context');
      expect(toolNames).toContain('get_dependency_graph');
      expect(toolNames).toContain('get_impact_analysis');
      expect(toolNames).toContain('suggest_refactoring');
      expect(toolNames).toContain('predict_impact_with_remediation');
      expect(toolNames).toContain('get_violation_patterns');
      expect(toolNames).toContain('analyze_many');
    });
  });

  describe('handleMessage - initialize', () => {
    it('should handle initialize request', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result).toEqual({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'gate-keeper', version: '1.0.0' },
      });
    });
  });

  describe('handleMessage - tools/list', () => {
    it('should return tools list', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.result).toHaveProperty('tools');
      expect((response.result as { tools: unknown[] }).tools.length).toBe(11);
    });
  });

  describe('handleMessage - tools/call', () => {
    beforeEach(() => {
      fs.writeFileSync(tempFilePath, 'export const test = 1;');
    });

    it('should call analyze_file tool', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'analyze_file', arguments: { file_path: tempFilePath } },
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.result).toHaveProperty('content');
    });

    it('should emit structuredContent alongside markdown for analyze_file', async () => {
      fs.writeFileSync(tempFilePath, 'const x: any = 1;\nconsole.log(x);\n');
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: { name: 'analyze_file', arguments: { file_path: tempFilePath } },
      };
      await handleMessage(msg);

      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      const result = response.result as {
        content: Array<{ text: string }>;
        structuredContent?: {
          version: string;
          tool: string;
          generatedAt: number;
          data: {
            path: string;
            rating: number;
            violations: Array<{
              type: string;
              ruleId?: string;
              span?: { line: number; column: number; endLine: number; endColumn: number; offset?: number; length?: number };
              codeSnippet?: string;
            }>;
          };
        };
      };

      expect(result.content[0].text).toContain('Rating');
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent?.version).toBe('1');
      expect(result.structuredContent?.tool).toBe('analyze_file');
      expect(typeof result.structuredContent?.generatedAt).toBe('number');

      const data = result.structuredContent!.data;
      expect(data.path).toBe(tempFilePath);
      expect(typeof data.rating).toBe('number');

      const anyViolation = data.violations.find(v => v.type === 'any_type');
      expect(anyViolation).toBeDefined();
      expect(anyViolation?.ruleId).toBe('ts/no-any');
      expect(anyViolation?.span?.line).toBe(1);
      expect(anyViolation?.span?.length ?? 0).toBe(3);
      expect(anyViolation?.codeSnippet).toContain('any');
    });

    it('should batch-analyze files and return a topological fixOrder', async () => {
      const fa = path.join('/tmp', `gate-keeper-many-a-${Date.now()}.ts`);
      const fb = path.join('/tmp', `gate-keeper-many-b-${Date.now()}.ts`);
      // b is a leaf; a imports b (so b should come before a in fixOrder)
      fs.writeFileSync(fb, 'export const HELPER = 1;\n');
      fs.writeFileSync(fa, `import { HELPER } from './${path.basename(fb).replace('.ts', '')}';\nexport const x = HELPER;\n`);

      try {
        const msg: JsonRpcRequest = {
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: { name: 'analyze_many', arguments: { file_paths: [fa, fb], max_parallel: 2 } },
        };
        await handleMessage(msg);

        const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
        const result = response.result as {
          structuredContent?: {
            tool: string;
            data: { analyses: Array<{ path: string }>; fixOrder: string[] };
          };
        };

        expect(result.structuredContent?.tool).toBe('analyze_many');
        const data = result.structuredContent!.data;
        expect(data.analyses).toHaveLength(2);
        // Whether b is resolved as a dependency depends on path resolution.
        // At minimum, fixOrder includes both paths.
        expect(data.fixOrder).toContain(fa);
        expect(data.fixOrder).toContain(fb);
      } finally {
        if (fs.existsSync(fa)) fs.unlinkSync(fa);
        if (fs.existsSync(fb)) fs.unlinkSync(fb);
      }
    });

    it('should emit structuredContent for analyze_code', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: {
          name: 'analyze_code',
          arguments: { code: 'console.log(1);', language: 'typescript' },
        },
      };
      await handleMessage(msg);

      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      const result = response.result as {
        structuredContent?: { tool: string; data: { violations: Array<{ type: string }> } };
      };

      expect(result.structuredContent?.tool).toBe('analyze_code');
      expect(result.structuredContent?.data.violations.some(v => v.type === 'console_log')).toBe(true);
    });

    it('should call get_quality_rules tool', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_quality_rules', arguments: {} },
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.result).toHaveProperty('content');
    });

    it('should emit structuredContent for get_quality_rules', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 41,
        method: 'tools/call',
        params: { name: 'get_quality_rules', arguments: {} },
      };
      await handleMessage(msg);

      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      const result = response.result as {
        structuredContent?: {
          tool: string;
          data: {
            minRating: number;
            rules: Array<{ ruleId: string; severity: string; deduction: number; fixable: boolean }>;
          };
        };
      };

      expect(result.structuredContent?.tool).toBe('get_quality_rules');
      expect(typeof result.structuredContent?.data.minRating).toBe('number');
      expect(Array.isArray(result.structuredContent?.data.rules)).toBe(true);
      const anyRule = result.structuredContent!.data.rules.find(r => r.ruleId === 'ts/no-any');
      expect(anyRule).toBeDefined();
      expect(anyRule?.fixable).toBe(true);
      const missingKey = result.structuredContent!.data.rules.find(r => r.ruleId === 'react/jsx-key');
      expect(missingKey?.severity).toBe('error');
    });

    it('should handle tool errors', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'analyze_file', arguments: { file_path: '/nonexistent.ts' } },
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.result).toHaveProperty('content');
    });

    it('should handle unknown tool', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'unknown_tool', arguments: {} },
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect((response.result as { content?: Array<{ text: string }> }).content?.[0]?.text)
        .toContain('Unknown tool');
    });
  });

  describe('handleMessage - ping', () => {
    it('should handle ping request', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 7,
        method: 'ping',
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.result).toEqual({});
    });
  });

  describe('handleMessage - notifications', () => {
    it('should handle initialized notification', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(0);
    });

    it('should send error for unknown method with id', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 8,
        method: 'unknown_method',
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
    });

    it('should ignore unknown method without id', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'unknown_method',
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(0);
    });
  });

  describe('send functions', () => {
    it('send should write JSON to stdout', () => {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { test: 'value' },
      };
      send(response);
      expect(capturedOutputs.length).toBe(1);
      expect(JSON.parse(capturedOutputs[0])).toEqual(response);
    });

    it('sendResult should send result', () => {
      sendResult(1, { data: 'test' });
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.result).toEqual({ data: 'test' });
    });

    it('sendError should send error', () => {
      sendError(1, -32600, 'Invalid Request');
      expect(capturedOutputs.length).toBe(1);
      const response = JSON.parse(capturedOutputs[0]) as JsonRpcResponse;
      expect(response.error).toEqual({ code: -32600, message: 'Invalid Request' });
    });
  });

  describe('processLine', () => {
    it('should process valid JSON-RPC message', () => {
      const buffer = { current: '' };
      const line = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n';
      processLine(line, buffer);
      expect(buffer.current).toBe('');
    });

    it('should skip empty lines', () => {
      const buffer = { current: '' };
      processLine('\n', buffer);
      expect(buffer.current).toBe('');
    });

    it('should skip Content-Length headers', () => {
      const buffer = { current: '' };
      processLine('Content-Length: 100\n', buffer);
      expect(buffer.current).toBe('');
    });

    it('should handle invalid JSON gracefully', () => {
      const buffer = { current: '' };
      const line = 'not valid json\n';
      expect(() => processLine(line, buffer)).not.toThrow();
    });

    it('should accumulate partial lines', () => {
      const buffer = { current: '' };
      processLine('{"jsonrpc":"2.0"', buffer);
      expect(buffer.current).toBe('{"jsonrpc":"2.0"');
      processLine(',"id":1,"method":"ping"}\n', buffer);
      expect(buffer.current).toBe('');
    });
  });

  describe('Error Handling', () => {
    it('should handle handler errors', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'analyze_file', arguments: { file_path: null } },
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
    });

    it('should handle malformed params', async () => {
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: null as unknown as Record<string, unknown>,
      };
      await handleMessage(msg);
      expect(capturedOutputs.length).toBe(1);
    });
  });

  describe('Integration', () => {
    beforeEach(() => {
      fs.writeFileSync(tempFilePath, 'export const test = 1;');
    });

    it('should handle full request-response cycle', async () => {
      // Initialize
      await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' });
      expect(capturedOutputs.length).toBe(1);

      // Get tools list
      await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(capturedOutputs.length).toBe(2);

      // Call a tool
      await handleMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'analyze_file', arguments: { file_path: tempFilePath } },
      });
      expect(capturedOutputs.length).toBe(3);
    });
  });
});
