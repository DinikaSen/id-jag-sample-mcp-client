import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './config.js';
import { CallbackServer } from './callback-server.js';
import { IdentityProviderSession } from './idp.js';
import { GatewayOAuthProvider } from './gateway-auth.js';
import { McpConnection } from './mcp.js';
import { Chat } from './chat.js';
import { log, truncate } from './log.js';

const HELP = `commands:
  /tools                 list the MCP server's tools
  /call <tool> [json]    call a tool directly, e.g. /call search {"query":"x"}
  /idtoken               show the current ID token claims (never the token itself)
  /help                  this text
  /quit                  exit
anything else is sent to the model, which may call tools.`;

async function main(): Promise<void> {
  const config = loadConfig();
  const callbacks = new CallbackServer(config.callbackPort);
  await callbacks.start();

  // 1. Sign in at the identity provider. The ID token from here goes on the header.
  const idp = new IdentityProviderSession(config.idp, callbacks);
  await idp.discover();
  await idp.signIn();

  // 2. Authorize at the MCP server. The SDK discovers its authorization server itself.
  const provider = new GatewayOAuthProvider(config.mcp, callbacks);
  const mcp = new McpConnection(config.mcp, idp, provider, config.logHttp);
  await mcp.connect();

  const tools = await mcp.listTools();
  log.ok(`${tools.length} tool(s) available: ${tools.map(t => t.name).join(', ') || 'none'}`);

  const chat = config.chat.apiKey ? new Chat(config.chat.apiKey, config.chat.model, tools, (n, a) => mcp.callTool(n, a)) : undefined;
  if (!chat) {
    log.warn('ANTHROPIC_API_KEY is not set; chat is disabled, /call still works');
  }
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
        for (const tool of tools) {
          console.log(`  ${tool.name}${tool.description ? ' ' + log.dim(tool.description.split('\n')[0]) : ''}`);
        }
      } else if (line === '/idtoken') {
        console.log(JSON.stringify(idp.claims() ?? {}, null, 2));
      } else if (line.startsWith('/call ')) {
        const [, name, ...rest] = line.split(' ');
        const args = rest.length ? (JSON.parse(rest.join(' ')) as Record<string, unknown>) : {};
        const outcome = await mcp.callTool(name, args);
        console.log((outcome.isError ? 'error: ' : '') + truncate(outcome.text, 4000));
      } else if (chat) {
        await chat.turn(line);
      } else {
        log.warn('chat is disabled; use /call to invoke tools');
      }
    } catch (err) {
      log.error((err as Error).message);
    }
  }
  rl.close();

  async function shutdown(): Promise<void> {
    await mcp.close().catch(() => undefined);
    callbacks.close();
    process.exit(0);
  }
}

main().catch(err => {
  log.error((err as Error).message);
  process.exit(1);
});
