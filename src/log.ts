const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(code: string, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const log = {
  info: (msg: string) => console.log(paint('36', '•') + ' ' + msg),
  ok: (msg: string) => console.log(paint('32', '✓') + ' ' + msg),
  warn: (msg: string) => console.log(paint('33', '!') + ' ' + msg),
  error: (msg: string) => console.error(paint('31', '✗') + ' ' + msg),
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

export function describeToken(label: string, token: string): string {
  const decoded = decodeJwt(token);
  if (!decoded) {
    return `${label}: opaque token (${token.length} chars)`;
  }
  const p = decoded.payload;
  const exp = typeof p.exp === 'number' ? new Date(p.exp * 1000).toISOString() : 'n/a';
  const aud = Array.isArray(p.aud) ? p.aud.join(', ') : String(p.aud ?? 'n/a');
  return `${label}: iss=${p.iss ?? 'n/a'} sub=${p.sub ?? 'n/a'} aud=[${aud}] azp=${p.azp ?? 'n/a'} exp=${exp}`;
}

export function truncate(text: string, max = 600): string {
  return text.length > max ? text.slice(0, max) + log.dim(` … (${text.length - max} more chars)`) : text;
}
