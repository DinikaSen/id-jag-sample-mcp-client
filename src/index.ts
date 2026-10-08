import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './config.js';
import { LocalServer } from './local-server.js';
import { App } from './app.js';
import { registerUiRoutes } from './ui-server.js';
import { openInBrowser } from './browser.js';
import { bus } from './events.js';
import { log, truncate } from './log.js';

const HELP = `commands:
  /tools                 list the MCP server's tools
  /call <tool> [json]    call a tool directly, e.g. /call search {"query":"x"}
  /idtoken               show the current ID token claims (never the token itself)
  /help                  this text
  /quit                  exit
anything else is sent to the model, which may call tools.`;

async function main(): Promise<void> {
  const uiMode = process.argv.includes('--ui');
  const config = loadConfig();
  const server = new LocalServer(config.callbackPort, uiMode ? '/' : undefined);
  await server.start();

  if (uiMode) {
    // The browser is already the user agent: the UI follows the authorization URL
    // itself, so no redirect is opened from here.
    const app = new App(config, server, () => undefined);
    registerUiRoutes(server, app);
    openInBrowser(new URL(`http://localhost:${config.callbackPort}/`), 'Web UI');
    return;
  }

  const app = new App(config, server, url => openInBrowser(url, 'Sign in to authorize access to the MCP server'));
  bus.onEvent(event => {
    if (event.type === 'assistant') {
      log.assistant(event.text);
    } else if (event.type === 'tool_call') {
      log.tool(`${event.name}(${JSON.stringify(event.args)})`);
    } else if (event.type === 'tool_result') {
      log.tool((event.isError ? 'error: ' : '') + truncate(event.text));
    }
  });
  await app.signIn();
  console.log(HELP);

  const rl = createInterface({ input: stdin, output: stdout });
  rl.on('close', () => void shutdown());

  for (;;) {
    const line = (await rl.question('\n> ')).trim();
    if (!line) {
      continue;
    }
    try {
      if (line === '/quit' || line === '/exit') {
        break;
      } else if (line === '/help') {
        console.log(HELP);
      } else if (line === '/tools') {
        for (const tool of app.listTools()) {
          console.log(`  ${tool.name}${tool.description ? ' ' + log.dim(tool.description.split('\n')[0]) : ''}`);
        }
      } else if (line === '/idtoken') {
        console.log(JSON.stringify(app.provider.idTokenClaims() ?? {}, null, 2));
      } else if (line.startsWith('/call ')) {
        const [, name, ...rest] = line.split(' ');
        const args = rest.length ? (JSON.parse(rest.join(' ')) as Record<string, unknown>) : {};
        const outcome = await app.callTool(name, args);
        console.log((outcome.isError ? 'error: ' : '') + truncate(outcome.text, 4000));
      } else {
        await app.send(line);
      }
    } catch (err) {
      log.error((err as Error).message);
    }
  }
  rl.close();

  async function shutdown(): Promise<void> {
    await app.close();
    server.close();
    process.exit(0);
  }
}

main().catch(err => {
  log.error((err as Error).message);
  process.exit(1);
});
