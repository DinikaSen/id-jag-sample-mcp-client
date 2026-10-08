import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdTokenFetch } from './id-token-fetch.js';

const serverUrl = new URL('https://gateway.example/mcp/atlassian');

function fakeFetch(seen: { url: string; headers: Headers }[]) {
  return async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response('{}', { status: 200 });
  };
}

test('adds the ID token header to requests for the MCP server', async () => {
  const seen: { url: string; headers: Headers }[] = [];
  let calls = 0;
  const fetchWithIdToken = createIdTokenFetch({
    serverUrl,
    headerName: 'X-ID-Token',
    idToken: async () => `id-token-${++calls}`,
    baseFetch: fakeFetch(seen),
  });

  await fetchWithIdToken(serverUrl, { method: 'POST', headers: { Authorization: 'Bearer at' }, body: '{"method":"tools/list"}' });
  await fetchWithIdToken(serverUrl, { method: 'POST', body: '{"method":"tools/call"}' });

  assert.equal(seen[0].headers.get('x-id-token'), 'id-token-1');
  assert.equal(seen[0].headers.get('authorization'), 'Bearer at', 'existing headers are kept');
  assert.equal(seen[1].headers.get('x-id-token'), 'id-token-2', 'the token is fetched fresh per request');
});

test('leaves authorization server traffic untouched', async () => {
  const seen: { url: string; headers: Headers }[] = [];
  const fetchWithIdToken = createIdTokenFetch({
    serverUrl,
    headerName: 'X-ID-Token',
    idToken: async () => {
      throw new Error('must not be called for non-MCP requests');
    },
    baseFetch: fakeFetch(seen),
  });

  await fetchWithIdToken('https://idp.example/oauth2/token', { method: 'POST' });
  await fetchWithIdToken('https://gateway.example/.well-known/oauth-protected-resource/mcp/atlassian');
  await fetchWithIdToken('https://gateway.example/mcp/other');

  for (const request of seen) {
    assert.equal(request.headers.get('x-id-token'), null, request.url);
  }
});
