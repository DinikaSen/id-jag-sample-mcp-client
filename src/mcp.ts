import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpConfig } from './config.js';
import { GatewayOAuthProvider } from './gateway-auth.js';
import { createIdTokenFetch } from './id-token-fetch.js';
import { log } from './log.js';

export interface ToolCallOutcome {
  text: string;
  isError: boolean;
}

/**
 * The MCP session with the gateway. The access token is handled by the SDK through
 * GatewayOAuthProvider; the ID token from the same sign-in is attached by the fetch wrapper.
 */
export class McpConnection {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;

  constructor(
    private readonly mcp: McpConfig,
    private readonly provider: GatewayOAuthProvider,
    private readonly logHttp: boolean,
  ) {}

  async connect(): Promise<void> {
    await this.provider.applyAuthServerOverride();
    let authorized = false;
    for (;;) {
      this.transport = new StreamableHTTPClientTransport(this.mcp.serverUrl, {
        authProvider: this.provider,
        fetch: createIdTokenFetch({
          serverUrl: this.mcp.serverUrl,
          headerName: this.mcp.idTokenHeader,
          idToken: () => this.provider.idToken(),
          logHttp: this.logHttp,
        }),
      });
      this.client = new Client({ name: 'id-jag-sample-mcp-client', version: '0.1.0' });
      try {
        await this.client.connect(this.transport);
        log.ok(`connected to ${this.mcp.serverUrl}`);
        return;
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) {
          throw err;
        }
        if (authorized) {
          // One sign-in succeeded and the server still answered 401: signing in again
          // would only open more browser windows. The last logged WWW-Authenticate
          // line says why the token was rejected.
          throw new Error(
            'the MCP server rejected a freshly issued access token. ' +
              'If the token was logged as opaque, the authorization server must issue JWT access tokens for this client. ' +
              'Otherwise check the gateway logs for the policy that rejected it.',
          );
        }
        log.info('the MCP server requires authorization; waiting for the browser');
        const code = await this.provider.awaitAuthorizationCode();
        await this.transport.finishAuth(code);
        authorized = true;
      }
    }
  }

  async listTools(): Promise<Tool[]> {
    return this.withAuthRetry(async client => (await client.listTools()).tools);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    return this.withAuthRetry(async client => {
      const result = await client.callTool({ name, arguments: args });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map(block => (block.type === 'text' ? block.text : `[${block.type} content omitted]`))
        .join('\n');
      return { text: text || JSON.stringify(result.structuredContent ?? {}), isError: result.isError === true };
    });
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  /** Completes an authorization redirect the SDK asked for mid-session, then retries once. */
  private async withAuthRetry<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = this.requireClient();
    try {
      return await fn(client);
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        throw err;
      }
      log.info('the MCP server asked for re-authorization; waiting for the browser');
      const code = await this.provider.awaitAuthorizationCode();
      await this.transport!.finishAuth(code);
      return fn(client);
    }
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error('not connected');
    }
    return this.client;
  }
}
