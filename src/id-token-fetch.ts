import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { log } from './log.js';

export interface IdTokenFetchOptions {
  /** The MCP server URL. Only requests to exactly this origin and path get the header. */
  serverUrl: URL;
  headerName: string;
  /** The current ID token, or undefined before the sign-in has completed. */
  idToken: () => string | undefined;
  logHttp?: boolean;
  baseFetch?: FetchLike;
}

/**
 * Wraps fetch so every request to the MCP server carries the ID token on the
 * configured header. The MCP SDK uses the same fetch for OAuth traffic to the
 * authorization server; those requests are passed through untouched.
 */
export function createIdTokenFetch(options: IdTokenFetchOptions): FetchLike {
  const base = options.baseFetch ?? fetch;
  const target = options.serverUrl;

  return async (url, init) => {
    const requestUrl = new URL(url);
    const toMcpServer = requestUrl.origin === target.origin && requestUrl.pathname === target.pathname;
    if (!toMcpServer) {
      if (options.logHttp) {
        log.http(`${init?.method ?? 'GET'} ${requestUrl.origin}${requestUrl.pathname} (authorization server)`);
      }
      return base(url, init);
    }

    const headers = new Headers(init?.headers);
    const idToken = options.idToken();
    if (idToken) {
      headers.set(options.headerName, idToken);
    }
    const response = await base(url, { ...init, headers });

    if (options.logHttp) {
      const method = init?.method ?? 'GET';
      const rpc = jsonRpcMethod(init?.body);
      const sent = idToken ? ` + ${options.headerName}` : '';
      const challenge = response.status === 401 ? ` WWW-Authenticate: ${response.headers.get('www-authenticate') ?? ''}` : '';
      log.http(`${method} ${requestUrl.pathname}${rpc ? ' ' + rpc : ''}${sent} -> ${response.status}${challenge}`);
    }
    return response;
  };
}

function jsonRpcMethod(body: BodyInit | null | undefined): string | undefined {
  if (typeof body !== 'string') {
    return undefined;
  }
  try {
    const parsed = JSON.parse(body) as { method?: unknown } | { method?: unknown }[];
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return typeof first?.method === 'string' ? first.method : undefined;
  } catch {
    return undefined;
  }
}
