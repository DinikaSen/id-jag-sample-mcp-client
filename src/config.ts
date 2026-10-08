/**
 * Configuration is read from environment variables (see .env.example).
 *
 * The client needs only the MCP server URL. Its authorization server is discovered
 * from the server's protected resource metadata, as for any MCP client, unless
 * MCP_AUTH_SERVER_METADATA_URL overrides it. The ID token comes from that same
 * sign-in, so no separate identity provider configuration exists.
 */
export interface McpConfig {
  serverUrl: URL;
  /** Pre-registered client id. When unset the client registers dynamically. */
  clientId?: string;
  clientSecret?: string;
  /** Authorization server metadata document to use instead of discovery. */
  authServerMetadataUrl?: URL;
  /** Fallback scope when neither the 401 challenge nor the resource metadata names any. */
  scopes: string;
  redirectUrl: string;
  idTokenHeader: string;
}

/** Where chat requests go. Undefined disables chat. */
export type LlmRoute =
  | { via: 'gateway'; baseUrl: URL; apiKey: string }
  | { via: 'direct'; apiKey: string };

export interface ChatConfig {
  llm?: LlmRoute;
  model: string;
}

export interface AppConfig {
  mcp: McpConfig;
  chat: ChatConfig;
  callbackPort: number;
  logHttp: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const callbackPort = intOr(env.CALLBACK_PORT, 8765);
  const metadataUrl = blankToUndefined(env.MCP_AUTH_SERVER_METADATA_URL);

  return {
    mcp: {
      serverUrl: new URL(required(env, 'MCP_SERVER_URL')),
      clientId: blankToUndefined(env.MCP_CLIENT_ID),
      clientSecret: blankToUndefined(env.MCP_CLIENT_SECRET),
      authServerMetadataUrl: metadataUrl ? new URL(metadataUrl) : undefined,
      scopes: env.MCP_SCOPES?.trim() || 'openid',
      redirectUrl: `http://localhost:${callbackPort}/callback`,
      idTokenHeader: env.ID_TOKEN_HEADER?.trim() || 'X-ID-Token',
    },
    chat: {
      llm: llmRoute(env),
      model: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5',
    },
    callbackPort,
    logHttp: (env.LOG_HTTP ?? 'true').toLowerCase() !== 'false',
  };
}

/**
 * LLM_PROXY_URL sends chat through the gateway's Anthropic proxy, authenticated with
 * LLM_PROXY_API_KEY on X-API-Key; the gateway holds the Anthropic key. Without it,
 * ANTHROPIC_API_KEY calls Anthropic directly.
 */
function llmRoute(env: NodeJS.ProcessEnv): LlmRoute | undefined {
  const proxyUrl = blankToUndefined(env.LLM_PROXY_URL);
  if (proxyUrl) {
    return { via: 'gateway', baseUrl: new URL(proxyUrl), apiKey: required(env, 'LLM_PROXY_API_KEY') };
  }
  const apiKey = blankToUndefined(env.ANTHROPIC_API_KEY);
  return apiKey ? { via: 'direct', apiKey } : undefined;
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
