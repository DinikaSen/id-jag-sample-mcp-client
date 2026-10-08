/**
 * Configuration is read from environment variables (see .env.example).
 *
 * Two independent OAuth relationships are configured:
 *   IDP_*  - the OpenID Connect identity provider the user signs in at. The ID token
 *            from this sign-in is sent to the gateway on ID_TOKEN_HEADER.
 *   MCP_*  - the MCP server (gateway). Its authorization server is discovered through
 *            protected resource metadata, as for any MCP client.
 */
export interface IdpConfig {
  issuer: URL;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  redirectUrl: string;
}

export interface McpConfig {
  serverUrl: URL;
  /** Pre-registered client id. When unset the client registers dynamically. */
  clientId?: string;
  clientSecret?: string;
  /** Fallback scope when the server advertises none. */
  scopes?: string;
  redirectUrl: string;
  idTokenHeader: string;
}

export interface ChatConfig {
  apiKey?: string;
  model: string;
}

export interface AppConfig {
  idp: IdpConfig;
  mcp: McpConfig;
  chat: ChatConfig;
  callbackPort: number;
  logHttp: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const callbackPort = intOr(env.CALLBACK_PORT, 8765);
  const callbackBase = `http://localhost:${callbackPort}`;

  return {
    idp: {
      issuer: new URL(required(env, 'IDP_ISSUER')),
      clientId: required(env, 'IDP_CLIENT_ID'),
      clientSecret: blankToUndefined(env.IDP_CLIENT_SECRET),
      scopes: env.IDP_SCOPES?.trim() || 'openid',
      redirectUrl: `${callbackBase}/idp/callback`,
    },
    mcp: {
      serverUrl: new URL(required(env, 'MCP_SERVER_URL')),
      clientId: blankToUndefined(env.MCP_CLIENT_ID),
      clientSecret: blankToUndefined(env.MCP_CLIENT_SECRET),
      scopes: blankToUndefined(env.MCP_SCOPES),
      redirectUrl: `${callbackBase}/mcp/callback`,
      idTokenHeader: env.ID_TOKEN_HEADER?.trim() || 'X-ID-Token',
    },
    chat: {
      apiKey: blankToUndefined(env.ANTHROPIC_API_KEY),
      model: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5',
    },
    callbackPort,
    logHttp: (env.LOG_HTTP ?? 'true').toLowerCase() !== 'false',
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required (see .env.example)`);
  }
  return value;
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function intOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
