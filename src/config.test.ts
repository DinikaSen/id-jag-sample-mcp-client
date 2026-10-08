import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const base = {
  IDP_ISSUER: 'https://idp.example/oauth2/token',
  IDP_CLIENT_ID: 'sample-app',
  MCP_SERVER_URL: 'https://gateway.example/mcp/atlassian',
};

test('defaults: public clients, openid scope, X-ID-Token header, port 8765', () => {
  const config = loadConfig(base);
  assert.equal(config.idp.clientSecret, undefined);
  assert.equal(config.idp.scopes, 'openid');
  assert.equal(config.idp.redirectUrl, 'http://localhost:8765/idp/callback');
  assert.equal(config.mcp.clientId, undefined);
  assert.equal(config.mcp.redirectUrl, 'http://localhost:8765/mcp/callback');
  assert.equal(config.mcp.idTokenHeader, 'X-ID-Token');
  assert.equal(config.chat.apiKey, undefined);
  assert.equal(config.logHttp, true);
});

test('confidential clients and overrides', () => {
  const config = loadConfig({
    ...base,
    IDP_CLIENT_SECRET: 's1',
    IDP_SCOPES: 'openid profile',
    MCP_CLIENT_ID: 'gw-client',
    MCP_CLIENT_SECRET: 's2',
    MCP_SCOPES: 'read:jira',
    ID_TOKEN_HEADER: 'X-Identity',
    CALLBACK_PORT: '9000',
    LOG_HTTP: 'false',
  });
  assert.equal(config.idp.clientSecret, 's1');
  assert.equal(config.idp.scopes, 'openid profile');
  assert.equal(config.mcp.clientId, 'gw-client');
  assert.equal(config.mcp.clientSecret, 's2');
  assert.equal(config.mcp.scopes, 'read:jira');
  assert.equal(config.mcp.idTokenHeader, 'X-Identity');
  assert.equal(config.idp.redirectUrl, 'http://localhost:9000/idp/callback');
  assert.equal(config.logHttp, false);
});

test('missing required values name the variable', () => {
  assert.throws(() => loadConfig({ ...base, IDP_ISSUER: '' }), /IDP_ISSUER is required/);
});
