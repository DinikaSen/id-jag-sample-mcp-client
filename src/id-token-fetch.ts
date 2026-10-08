import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { bus } from './events.js';
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
      const response = await base(url, init);
      if (options.logHttp) {
        log.http(`${init?.method ?? 'GET'} ${requestUrl.origin}${requestUrl.pathname} (authorization server) -> ${response.status}`);
      }
      bus.emitEvent({ type: 'http', target: 'auth', method: init?.method ?? 'GET', path: `${requestUrl.origin}${requestUrl.pathname}`, idTokenSent: false, status: response.status });
      return response;
    }

    const headers = new Headers(init?.headers);
    const idToken = options.idToken();
    if (idToken) {
      headers.set(options.headerName, idToken);
    }
    const response = await base(url, { ...init, headers });

    const method = init?.method ?? 'GET';
    const rpc = jsonRpcMethod(init?.body);
    const challenge = response.status === 401 ? (response.headers.get('www-authenticate') ?? '') : undefined;
    if (options.logHttp) {
      const sent = idToken ? ` + ${options.headerName}` : '';
      log.http(`${method} ${requestUrl.pathname}${rpc ? ' ' + rpc : ''}${sent} -> ${response.status}${challenge !== undefined ? ' WWW-Authenticate: ' + challenge : ''}`);
    }
    bus.emitEvent({ type: 'http', target: 'mcp', method, path: requestUrl.pathname, rpc, idTokenSent: Boolean(idToken), status: response.status, challenge });

    if (method === 'GET' && response.status === 401 && !challenge) {
      // The SDK's optional server-to-client stream. A 401 without a challenge comes from
      // behind the gateway, not from its authentication, and the SDK would answer it by
      // starting a new sign-in that nothing awaits. Present it as 405, the SDK's signal
      // for "no stream offered", which it accepts quietly.
      log.warn(`the server answered the GET stream with 401 and no WWW-Authenticate; treating it as "stream not offered" (405)`);
      await response.body?.cancel();
      return new Response(null, { status: 405, statusText: 'Method Not Allowed', headers: { Allow: 'POST' } });
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
