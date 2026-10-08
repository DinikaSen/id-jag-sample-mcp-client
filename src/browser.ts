import { spawn } from 'node:child_process';
import { log } from './log.js';

/** Prints the URL and tries to open it in the default browser. Printing is the fallback. */
export function openInBrowser(url: URL, purpose: string): void {
  log.info(`${purpose}. If the browser does not open, visit:\n  ${url.toString()}`);
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url.toString()]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url.toString()]]
        : ['xdg-open', [url.toString()]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    // The URL was printed already.
  }
}
