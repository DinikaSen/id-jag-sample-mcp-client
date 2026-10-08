import { createServer, type Server } from 'node:http';
import { log } from './log.js';

interface Pending {
  state: string;
  resolve: (url: URL) => void;
  reject: (err: Error) => void;
}

/**
 * One local HTTP listener that receives both redirect callbacks:
 *   /idp/callback  - the OpenID Connect sign-in at the identity provider
 *   /mcp/callback  - the OAuth authorization at the MCP server's authorization server
 *
 * Each pending flow is keyed by path and matched on `state` so a stray callback
 * cannot complete the wrong flow.
 */
export class CallbackServer {
  private server?: Server;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly port: number) {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
      const pending = this.pending.get(url.pathname);
      if (!pending) {
        res.writeHead(404).end('No authorization in progress for this path.');
        return;
      }
      if (url.searchParams.get('state') !== pending.state) {
        res.writeHead(400).end('State mismatch. Ignoring this callback.');
        return;
      }
      this.pending.delete(url.pathname);
      const error = url.searchParams.get('error');
      if (error) {
        const description = url.searchParams.get('error_description') ?? '';
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(page('Authorization failed', `${error} ${description}`));
        pending.reject(new Error(`authorization failed: ${error} ${description}`.trim()));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Signed in', 'You can close this window and return to the terminal.'));
      pending.resolve(url);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve());
    });
    log.info(`callback listener on http://localhost:${this.port}`);
  }

  /** Resolves with the full callback URL once the browser is redirected back. */
  waitFor(path: string, state: string, timeoutMs = 5 * 60 * 1000): Promise<URL> {
    return new Promise<URL>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(path);
        reject(new Error(`timed out waiting for the browser callback on ${path}`));
      }, timeoutMs);
      this.pending.set(path, {
        state,
        resolve: url => {
          clearTimeout(timer);
          resolve(url);
        },
        reject: err => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  close(): void {
    this.server?.close();
  }
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: system-ui; margin: 3rem"><h2>${title}</h2><p>${body}</p></body></html>`;
}
