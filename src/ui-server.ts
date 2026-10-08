import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { LocalServer, readJsonBody, sendJson } from './local-server.js';
import { App } from './app.js';
import { bus, type AppEvent } from './events.js';

const UI_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'index.html');

/**
 * HTTP routes for the web UI, on the same local port as the OAuth callback.
 *   GET  /             the single-page UI
 *   GET  /api/status   session state, user, token claims, tools
 *   POST /api/signin   start the sign-in; the UI follows status.authorizationUrl
 *   POST /api/chat     {message}; the turn's output arrives on /api/events
 *   POST /api/call     {name, args}; direct tool call, returns the result
 *   POST /api/reset    clear the chat history
 *   GET  /api/events   server-sent events: log, http, assistant, tool_call, tool_result, turn_done, status
 */
export function registerUiRoutes(server: LocalServer, app: App): void {
  server.route('GET', '/', async (_req, res) => {
    const html = await readFile(UI_FILE, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
  });

  server.route('GET', '/api/status', (_req, res) => sendJson(res, 200, app.status()));

  server.route('POST', '/api/signin', (_req, res) => {
    app.signIn().catch(() => undefined);
    sendJson(res, 202, { started: true });
  });

  server.route('POST', '/api/chat', async (req, res) => {
    const { message } = await readJsonBody<{ message?: string }>(req);
    if (!message?.trim()) {
      sendJson(res, 400, { error: 'message is required' });
      return;
    }
    app.send(message.trim()).catch(err => bus.emitEvent({ type: 'log', level: 'error', text: (err as Error).message }));
    sendJson(res, 202, { started: true });
  });

  server.route('POST', '/api/call', async (req, res) => {
    const { name, args } = await readJsonBody<{ name?: string; args?: Record<string, unknown> }>(req);
    if (!name) {
      sendJson(res, 400, { error: 'name is required' });
      return;
    }
    bus.emitEvent({ type: 'tool_call', name, args: args ?? {} });
    const outcome = await app.callTool(name, args ?? {});
    bus.emitEvent({ type: 'tool_result', name, text: outcome.text, isError: outcome.isError });
    sendJson(res, 200, outcome);
  });

  server.route('POST', '/api/reset', (_req, res) => {
    app.resetChat();
    sendJson(res, 200, { ok: true });
  });

  server.route('GET', '/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const unsubscribe = bus.onEvent(event => writeEvent(res, event));
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}

function writeEvent(res: ServerResponse, event: AppEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
