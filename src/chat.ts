import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool as AnthropicTool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolCallOutcome } from './mcp.js';
import type { ChatConfig } from './config.js';
import { bus } from './events.js';
import { log } from './log.js';

const SYSTEM_PROMPT =
  'You are an internal support assistant used by a company\'s support staff, running in a sample application. ' +
  'You have tools from an MCP server; use them when they help answer the user, and prefer looking things up over guessing. ' +
  'Keep answers concise and factual. If a tool call fails, say what failed instead of inventing a result.';

const MAX_TOOL_ROUNDS = 12;

/** Reports each model call on the bus so the trace shows LLM traffic beside MCP traffic. */
function tracingFetch(via: 'gateway' | 'direct', logHttp: boolean): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'POST';
    const path = `${url.origin}${url.pathname}`;
    if (logHttp) {
      log.http(`${method} ${path} (LLM ${via === 'gateway' ? 'via gateway' : 'direct'}) -> ${response.status}`);
    }
    bus.emitEvent({ type: 'http', target: 'llm', method, path, idTokenSent: false, status: response.status });
    return response;
  };
}

/** Minimal tool-use loop: one user turn may run several tool rounds before the final answer. */
export class Chat {
  private readonly anthropic: Anthropic;
  private history: MessageParam[] = [];
  private readonly tools: AnthropicTool[];

  private readonly model: string;

  constructor(
    config: ChatConfig,
    mcpTools: McpTool[],
    private readonly callTool: (name: string, args: Record<string, unknown>) => Promise<ToolCallOutcome>,
    logHttp = true,
  ) {
    const llm = config.llm;
    if (!llm) {
      throw new Error('chat is disabled: set LLM_PROXY_URL or ANTHROPIC_API_KEY');
    }
    this.model = config.model;
    // Through the gateway, the SDK's own x-api-key header carries the gateway key
    // (header names are case-insensitive); the gateway swaps in the Anthropic key.
    this.anthropic = new Anthropic({
      apiKey: llm.apiKey,
      baseURL: llm.via === 'gateway' ? llm.baseUrl.toString().replace(/\/$/, '') : undefined,
      fetch: tracingFetch(llm.via, logHttp),
    });
    this.tools = mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: { ...tool.inputSchema, type: 'object' as const },
    }));
  }

  reset(): void {
    this.history = [];
  }

  async turn(userText: string): Promise<void> {
    this.history.push({ role: 'user', content: userText });
    try {
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
            bus.emitEvent({ type: 'assistant', text: block.text.trim() });
          }
        }

        const toolUses = response.content.filter(block => block.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
          return;
        }

        const results: ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          const args = (use.input ?? {}) as Record<string, unknown>;
          bus.emitEvent({ type: 'tool_call', name: use.name, args });
          let outcome: ToolCallOutcome;
          try {
            outcome = await this.callTool(use.name, args);
          } catch (err) {
            outcome = { text: `tool call failed: ${(err as Error).message}`, isError: true };
          }
          bus.emitEvent({ type: 'tool_result', name: use.name, text: outcome.text, isError: outcome.isError });
          results.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.text, is_error: outcome.isError });
        }
        this.history.push({ role: 'user', content: results });
      }
      log.warn('stopped after too many tool rounds in one turn');
    } finally {
      bus.emitEvent({ type: 'turn_done' });
    }
  }
}
