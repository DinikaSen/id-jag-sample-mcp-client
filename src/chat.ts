import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool as AnthropicTool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolCallOutcome } from './mcp.js';
import { log, truncate } from './log.js';

const SYSTEM_PROMPT =
  'You are a helpful assistant in a terminal. You have tools from an MCP server; use them when they help answer the user. ' +
  'Keep answers concise. If a tool call fails, say what failed instead of guessing.';

const MAX_TOOL_ROUNDS = 12;

/** Minimal tool-use loop: one user turn may run several tool rounds before the final answer. */
export class Chat {
  private readonly anthropic: Anthropic;
  private readonly history: MessageParam[] = [];
  private readonly tools: AnthropicTool[];

  constructor(
    apiKey: string,
    private readonly model: string,
    mcpTools: McpTool[],
    private readonly callTool: (name: string, args: Record<string, unknown>) => Promise<ToolCallOutcome>,
  ) {
    this.anthropic = new Anthropic({ apiKey });
    this.tools = mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: { ...tool.inputSchema, type: 'object' as const },
    }));
  }

  async turn(userText: string): Promise<void> {
    this.history.push({ role: 'user', content: userText });

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: this.history,
        tools: this.tools,
      });
      this.history.push({ role: 'assistant', content: response.content });

      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          log.assistant(block.text.trim());
        }
      }

      const toolUses = response.content.filter(block => block.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        return;
      }

      const results: ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const args = (use.input ?? {}) as Record<string, unknown>;
        log.tool(`${use.name}(${JSON.stringify(args)})`);
        let outcome: ToolCallOutcome;
        try {
          outcome = await this.callTool(use.name, args);
        } catch (err) {
          outcome = { text: `tool call failed: ${(err as Error).message}`, isError: true };
        }
        log.tool((outcome.isError ? 'error: ' : '') + truncate(outcome.text));
        results.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.text, is_error: outcome.isError });
      }
      this.history.push({ role: 'user', content: results });
    }
    log.warn('stopped after too many tool rounds in one turn');
  }
}
