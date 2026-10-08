import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const base = { MCP_SERVER_URL: 'https://gateway.example/mcp/atlassian' };

test('defaults: dynamic public client, discovery, openid fallback scope, X-ID-Token, port 8765', () => {
  const config = loadConfig(base);
  assert.equal(config.mcp.clientId, undefined);
  assert.equal(config.mcp.clientSecret, undefined);
  assert.equal(config.mcp.authServerMetadataUrl, undefined);
  assert.equal(config.mcp.scopes, 'openid');
  assert.equal(config.mcp.redirectUrl, 'http://localhost:8765/callback');
  assert.equal(config.mcp.idTokenHeader, 'X-ID-Token');
  assert.equal(config.chat.apiKey, undefined);
  assert.equal(config.logHttp, true);
});

test('pre-registered confidential client with overrides', () => {
  const config = loadConfig({
    ...base,
    MCP_CLIENT_ID: 'gw-client',
    MCP_CLIENT_SECRET: 's2',
    MCP_AUTH_SERVER_METADATA_URL: 'https://idp.example/oauth2/token/.well-known/openid-configuration',
    MCP_SCOPES: 'openid read:jira',
    ID_TOKEN_HEADER: 'X-Identity',
    CALLBACK_PORT: '9000',
    LOG_HTTP: 'false',
  });
  assert.equal(config.mcp.clientId, 'gw-client');
  assert.equal(config.mcp.clientSecret, 's2');
  assert.equal(config.mcp.authServerMetadataUrl?.href, 'https://idp.example/oauth2/token/.well-known/openid-configuration');
  assert.equal(config.mcp.scopes, 'openid read:jira');
  assert.equal(config.mcp.idTokenHeader, 'X-Identity');
  assert.equal(config.mcp.redirectUrl, 'http://localhost:9000/callback');
  assert.equal(config.logHttp, false);
});

test('missing required values name the variable', () => {
  assert.throws(() => loadConfig({}), /MCP_SERVER_URL is required/);
});
