import { randomBytes } from 'node:crypto';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  OAuthMetadataSchema,
  OpenIdProviderDiscoveryMetadataSchema,
  type AuthorizationServerMetadata,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpConfig } from './config.js';
import { CallbackServer } from './callback-server.js';
import { openInBrowser } from './browser.js';
import { decodeJwt, describeToken, log } from './log.js';

/**
 * OAuthClientProvider for the MCP server (gateway). The MCP SDK drives the flow:
 * protected resource metadata discovery, authorization server metadata, dynamic
 * client registration when no client id is configured, PKCE, token exchange and
 * refresh. This class supplies client identity, in-memory storage, the optional
 * authorization server override, and keeps the ID token the sign-in returns.
 *
 * Everything lives in memory for the lifetime of the process. Nothing is written to disk.
 */
export class GatewayOAuthProvider implements OAuthClientProvider {
  private clientInfo?: OAuthClientInformationMixed;
  private savedTokens?: OAuthTokens;
  private verifier?: string;
  private currentState?: string;
  private pendingCallback?: Promise<URL>;
  private discovery?: OAuthDiscoveryState;

  constructor(
    private readonly mcp: McpConfig,
    private readonly callbacks: CallbackServer,
  ) {
    if (mcp.clientId) {
      this.clientInfo = { client_id: mcp.clientId, client_secret: mcp.clientSecret };
    }
  }

  /**
   * Applies MCP_AUTH_SERVER_METADATA_URL. The SDK then skips authorization server
   * discovery but still reads the protected resource metadata for scopes and resource.
   */
  async applyAuthServerOverride(): Promise<void> {
    if (!this.mcp.authServerMetadataUrl) {
      return;
    }
    const response = await fetch(this.mcp.authServerMetadataUrl);
    if (!response.ok) {
      throw new Error(`authorization server metadata at ${this.mcp.authServerMetadataUrl} returned HTTP ${response.status}`);
    }
    const json = await response.json();
    const oidc = OpenIdProviderDiscoveryMetadataSchema.safeParse(json);
    const metadata: AuthorizationServerMetadata = oidc.success ? oidc.data : OAuthMetadataSchema.parse(json);
    this.discovery = { authorizationServerUrl: metadata.issuer, authorizationServerMetadata: metadata };
    log.ok(`authorization server fixed by configuration: ${metadata.issuer}`);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discovery;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.discovery = state;
    const scopes = state.resourceMetadata?.scopes_supported;
    log.ok(`authorization server: ${state.authorizationServerUrl}` + (scopes ? ` (resource advertises scopes: ${scopes.join(' ')})` : ''));
    if (scopes && !scopes.includes('openid')) {
      log.warn('the resource metadata does not advertise the openid scope, so the sign-in may return no ID token');
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
      log.ok(`registered dynamically at the authorization server as client_id=${info.client_id}`);
    }
    this.clientInfo = info;
  }

  tokens(): OAuthTokens | undefined {
    return this.savedTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.savedTokens = tokens;
    log.ok(describeToken('access token', tokens.access_token) + (tokens.scope ? ` scope="${tokens.scope}"` : ''));
    if (tokens.id_token) {
      log.ok(describeToken('ID token', tokens.id_token));
    } else {
      log.warn('the token response carried no ID token; requests will go out without the ID token header');
    }
  }

  /** The ID token from the latest token response, or undefined before sign-in. */
  idToken(): string | undefined {
    return this.savedTokens?.id_token;
  }

  idTokenClaims(): Record<string, unknown> | undefined {
    const token = this.idToken();
    return token ? decodeJwt(token)?.payload : undefined;
  }

  /**
   * Registers the callback wait before the browser opens, so a fast sign-in
   * cannot arrive before anyone is listening for it.
   */
  redirectToAuthorization(url: URL): void {
    if (!this.currentState) {
      throw new Error('authorization redirect requested without a state value');
    }
    this.pendingCallback = this.callbacks.waitFor('/callback', this.currentState);
    openInBrowser(url, 'Sign in to authorize access to the MCP server');
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
    if ((scope === 'all' || scope === 'discovery') && !this.mcp.authServerMetadataUrl) {
      this.discovery = undefined;
    }
  }
}
