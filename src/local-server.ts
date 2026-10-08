import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { log } from './log.js';

interface Pending {
  state: string;
  resolve: (url: URL) => void;
  reject: (err: Error) => void;
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

/**
 * The one local HTTP listener. It always serves the OAuth redirect at /callback,
 * matched on `state` so a stray callback cannot complete a flow. In UI mode the
 * web app registers its routes on the same port.
 */
export class LocalServer {
  private server?: Server;
  private pending?: Pending;
  private readonly routes = new Map<string, RouteHandler>();

  constructor(
    private readonly port: number,
    /** Where the browser goes after a successful callback; undefined shows a plain page. */
    private readonly afterCallback?: string,
  ) {}

  route(method: string, path: string, handler: RouteHandler): void {
    this.routes.set(`${method} ${path}`, handler);
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
      if (url.pathname === '/callback') {
        this.handleCallback(url, res);
        return;
      }
      const handler = this.routes.get(`${req.method} ${url.pathname}`);
      if (!handler) {
        res.writeHead(404).end('not found');
        return;
      }
      Promise.resolve(handler(req, res, url)).catch(err => {
        log.error(`${req.method} ${url.pathname}: ${(err as Error).message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: (err as Error).message }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve());
    });
    log.info(`listening on http://localhost:${this.port}`);
  }

  /** Resolves with the full callback URL once the browser is redirected back. */
  waitFor(state: string, timeoutMs = 5 * 60 * 1000): Promise<URL> {
    return new Promise<URL>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error('timed out waiting for the browser callback'));
      }, timeoutMs);
      this.pending = {
        state,
        resolve: url => {
          clearTimeout(timer);
          resolve(url);
        },
        reject: err => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  close(): void {
    this.server?.close();
  }

  private handleCallback(url: URL, res: ServerResponse): void {
    const pending = this.pending;
    if (!pending) {
      res.writeHead(404).end('No authorization in progress.');
      return;
    }
    if (url.searchParams.get('state') !== pending.state) {
      res.writeHead(400).end('State mismatch. Ignoring this callback.');
      return;
    }
    this.pending = undefined;
    const error = url.searchParams.get('error');
    if (error) {
      const description = url.searchParams.get('error_description') ?? '';
      res.writeHead(400, { 'Content-Type': 'text/html' }).end(page('Authorization failed', `${error} ${description}`));
      pending.reject(new Error(`authorization failed: ${error} ${description}`.trim()));
      return;
    }
    pending.resolve(url);
    if (this.afterCallback) {
      res.writeHead(302, { Location: this.afterCallback }).end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('Signed in', 'You can close this window and return to the terminal.'));
    }
  }
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: system-ui; margin: 3rem"><h2>${title}</h2><p>${body}</p></body></html>`;
}
