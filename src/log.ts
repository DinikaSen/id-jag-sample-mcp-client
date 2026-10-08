import { bus } from './events.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(code: string, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function emit(level: 'info' | 'ok' | 'warn' | 'error', text: string): void {
  bus.emitEvent({ type: 'log', level, text });
}

export const log = {
  info: (msg: string) => {
    console.log(paint('36', '•') + ' ' + msg);
    emit('info', msg);
  },
  ok: (msg: string) => {
    console.log(paint('32', '✓') + ' ' + msg);
    emit('ok', msg);
  },
  warn: (msg: string) => {
    console.log(paint('33', '!') + ' ' + msg);
    emit('warn', msg);
  },
  error: (msg: string) => {
    console.error(paint('31', '✗') + ' ' + msg);
    emit('error', msg);
  },
  http: (msg: string) => console.log(paint('90', '  ' + msg)),
  tool: (msg: string) => console.log(paint('35', '⚙') + ' ' + msg),
  assistant: (msg: string) => console.log(paint('1', msg)),
  dim: (text: string) => paint('90', text),
};

/** Decodes a JWT's header and payload for display. The signature is never shown. */
export function decodeJwt(token: string): { header: unknown; payload: Record<string, unknown> } | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
    };
  } catch {
    return undefined;
  }
}

/** Display-safe summary of a token: claims only, never the token value. */
export function tokenSummary(token: string): Record<string, unknown> {
  const decoded = decodeJwt(token);
  if (!decoded) {
    return { opaque: true, length: token.length };
  }
  const p = decoded.payload;
  return {
    iss: p.iss,
    sub: p.sub,
    aud: p.aud,
    azp: p.azp,
    scope: p.scope,
    exp: typeof p.exp === 'number' ? new Date(p.exp * 1000).toISOString() : undefined,
  };
}

export function describeToken(label: string, token: string): string {
  const s = tokenSummary(token);
  if (s.opaque) {
    return `${label}: opaque token (${s.length} chars)`;
  }
  const aud = Array.isArray(s.aud) ? s.aud.join(', ') : String(s.aud ?? 'n/a');
  return `${label}: iss=${s.iss ?? 'n/a'} sub=${s.sub ?? 'n/a'} aud=[${aud}] azp=${s.azp ?? 'n/a'} exp=${s.exp ?? 'n/a'}`;
}

export function truncate(text: string, max = 600): string {
  return text.length > max ? text.slice(0, max) + log.dim(` … (${text.length - max} more chars)`) : text;
}
