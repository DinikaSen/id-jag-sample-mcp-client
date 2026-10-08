import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { AppConfig } from './config.js';
import { LocalServer } from './local-server.js';
import { GatewayOAuthProvider } from './gateway-auth.js';
import { McpConnection, type ToolCallOutcome } from './mcp.js';
import { Chat } from './chat.js';
import { bus } from './events.js';
import { log } from './log.js';

export type SessionState = 'idle' | 'authorizing' | 'connecting' | 'connected' | 'error';

export interface SessionStatus {
  state: SessionState;
  authorizationUrl?: string;
  error?: string;
  user?: { sub?: string; email?: string; name?: string };
  tokens?: { accessToken?: Record<string, unknown>; idToken?: Record<string, unknown> };
  tools?: { name: string; description?: string }[];
  chatEnabled: boolean;
  serverUrl: string;
  idTokenHeader: string;
  model: string;
}

/**
 * The application core shared by the terminal and the web UI: one sign-in, one MCP
 * session, one chat history.
 */
export class App {
  readonly provider: GatewayOAuthProvider;
  private readonly mcp: McpConnection;
  private chat?: Chat;
  private tools: Tool[] = [];
  private state: SessionState = 'idle';
  private authorizationUrl?: string;
  private error?: string;
  private busy = false;

  constructor(
    private readonly config: AppConfig,
    server: LocalServer,
    onRedirect?: (url: URL) => void,
  ) {
    this.provider = new GatewayOAuthProvider(config.mcp, server, {
      onRedirect: url => {
        this.authorizationUrl = url.toString();
        this.setState('authorizing');
        onRedirect?.(url);
      },
      onCallback: () => {
        // The browser is back; the page must not follow the stale authorization URL
        // while the code is exchanged and the session is set up.
        this.authorizationUrl = undefined;
        this.setState('connecting');
      },
    });
    this.mcp = new McpConnection(config.mcp, this.provider, config.logHttp);
  }

  /** Connects to the MCP server, signing in when it asks, then lists tools. */
  async signIn(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'authorizing') {
      return;
    }
    this.error = undefined;
    this.setState('connecting');
    try {
      await this.mcp.connect();
      this.tools = await this.mcp.listTools();
      log.ok(`${this.tools.length} tool(s) available: ${this.tools.map(t => t.name).join(', ') || 'none'}`);
      if (this.config.chat.apiKey) {
        this.chat = new Chat(this.config.chat.apiKey, this.config.chat.model, this.tools, (n, a) => this.callTool(n, a));
      } else {
        log.warn('ANTHROPIC_API_KEY is not set; chat is disabled, direct tool calls still work');
      }
      this.setState('connected');
    } catch (err) {
      this.error = (err as Error).message;
      this.authorizationUrl = undefined;
      log.error(this.error);
      this.setState('error');
      throw err;
    }
  }

  status(): SessionStatus {
    const claims = this.provider.idTokenClaims();
    return {
      state: this.state,
      authorizationUrl: this.authorizationUrl,
      error: this.error,
      user: claims
        ? { sub: str(claims.sub), email: str(claims.email), name: str(claims.name ?? claims.given_name ?? claims.preferred_username) }
        : undefined,
      tokens: this.provider.tokenSummaries(),
      tools: this.tools.map(t => ({ name: t.name, description: t.description })),
      chatEnabled: Boolean(this.chat),
      serverUrl: this.config.mcp.serverUrl.toString(),
      idTokenHeader: this.config.mcp.idTokenHeader,
      model: this.config.chat.model,
    };
  }

  listTools(): Tool[] {
    return this.tools;
  }

  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    return this.mcp.callTool(name, args);
  }

  /** Runs one chat turn. Output arrives on the event bus. */
  async send(message: string): Promise<void> {
    if (!this.chat) {
      throw new Error('chat is disabled: ANTHROPIC_API_KEY is not set');
    }
    if (this.busy) {
      throw new Error('a turn is already in progress');
    }
    this.busy = true;
    try {
      await this.chat.turn(message);
    } finally {
      this.busy = false;
    }
  }

  resetChat(): void {
    this.chat?.reset();
  }

  async close(): Promise<void> {
    await this.mcp.close().catch(() => undefined);
  }

  private setState(state: SessionState): void {
    this.state = state;
    bus.emitEvent({ type: 'status' });
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
