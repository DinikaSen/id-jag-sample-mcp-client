import { randomBytes } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpConfig } from './config.js';
import { CallbackServer } from './callback-server.js';
import { openInBrowser } from './browser.js';
import { describeToken, log } from './log.js';

/**
 * OAuthClientProvider for the MCP server (gateway). The MCP SDK drives the flow:
 * protected resource metadata discovery, authorization server metadata, dynamic
 * client registration when no client id is configured, PKCE, token exchange and
 * refresh. This class only supplies client identity and in-memory storage.
 *
 * Everything lives in memory for the lifetime of the process. Nothing is written to disk.
 */
export class GatewayOAuthProvider implements OAuthClientProvider {
  private clientInfo?: OAuthClientInformationMixed;
  private savedTokens?: OAuthTokens;
  private verifier?: string;
  private currentState?: string;
  private pendingCallback?: Promise<URL>;

  constructor(
    private readonly mcp: McpConfig,
    private readonly callbacks: CallbackServer,
  ) {
    if (mcp.clientId) {
      this.clientInfo = { client_id: mcp.clientId, client_secret: mcp.clientSecret };
    }
  }

  get redirectUrl(): string {
    return this.mcp.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'ID-JAG sample MCP client',
      redirect_uris: [this.mcp.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.mcp.clientSecret ? 'client_secret_basic' : 'none',
      scope: this.mcp.scopes,
    };
  }

  state(): string {
    this.currentState = randomBytes(16).toString('base64url');
    return this.currentState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInfo;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    if (!this.mcp.clientId) {
      log.ok(`registered dynamically at the gateway's authorization server as client_id=${info.client_id}`);
    }
    this.clientInfo = info;
  }

  tokens(): OAuthTokens | undefined {
    return this.savedTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.savedTokens = tokens;
    log.ok(describeToken('gateway access token', tokens.access_token) + (tokens.scope ? ` scope="${tokens.scope}"` : ''));
  }

  /**
   * Registers the callback wait before the browser opens, so a fast sign-in
   * cannot arrive before anyone is listening for it.
   */
  redirectToAuthorization(url: URL): void {
    if (!this.currentState) {
      throw new Error('authorization redirect requested without a state value');
    }
    this.pendingCallback = this.callbacks.waitFor('/mcp/callback', this.currentState);
    openInBrowser(url, 'Authorize access to the MCP server');
  }

  /** The authorization code from the redirect the SDK asked for, once it arrives. */
  async awaitAuthorizationCode(): Promise<string> {
    const pending = this.pendingCallback;
    if (!pending) {
      throw new Error('no authorization redirect is pending');
    }
    this.pendingCallback = undefined;
    const url = await pending;
    const code = url.searchParams.get('code');
    if (!code) {
      throw new Error('the authorization callback carried no code');
    }
    return code;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error('no PKCE code verifier saved');
    }
    return this.verifier;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all' || scope === 'tokens') {
      this.savedTokens = undefined;
    }
    if ((scope === 'all' || scope === 'client') && !this.mcp.clientId) {
      this.clientInfo = undefined;
    }
    if (scope === 'all' || scope === 'verifier') {
      this.verifier = undefined;
    }
  }
}
