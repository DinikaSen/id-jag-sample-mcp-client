# ID-JAG sample MCP client

A small terminal chat client for the Model Context Protocol that demonstrates the
**ID token** path of gateway-side [Identity Assertion Authorization Grant (ID-JAG)](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/)
token exchange, as implemented by the
[id-jag-token-exchange-policy](https://github.com/DinikaSen/id-jag-token-exchange-policy)
for the WSO2 AI Gateway.

The client does two independent things that a normal MCP client does not combine:

1. **Signs the user in at an OpenID Connect identity provider** with the
   authorization code flow and PKCE, and keeps the resulting **ID token**.
2. **Authorizes at the MCP server** the standard way: protected resource metadata
   discovery, dynamic client registration or a pre-registered client, PKCE, and
   a bearer access token on `Authorization`.

Every MCP request then carries the gateway access token on `Authorization` and
the ID token on a second header, `X-ID-Token` by default. Behind the gateway's
MCP Authentication policy, the ID-JAG policy exchanges that ID token at the
identity provider for an ID-JAG, presents it to the upstream MCP server's
authorization server, and forwards the request with the resulting access token.
The client never sees any upstream credential.

```
MCP client ──(Authorization: Bearer <gateway access token>, X-ID-Token: <ID token>)──▶ WSO2 AI Gateway
                                                                                      │ 1. MCP Authentication validates the access token
                                                                                      │ 2. ID-JAG policy: ID token ─▶ IdP ─▶ ID-JAG
                                                                                      │ 3. ID-JAG ─▶ Resource AS ─▶ upstream access token
                                                                                      ▼
                                                                               upstream MCP server
```

Built on the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk),
[openid-client](https://github.com/panva/openid-client) and the
[Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript). Nothing is patched or forked.

## Prerequisites

- Node.js 20.6 or newer.
- An OpenID Connect identity provider where you can register a client.
- An MCP server behind a WSO2 AI Gateway with the MCP Authentication policy and
  the ID-JAG policy attached in `id_token` mode.
- Optionally an Anthropic API key for the chat loop. Without it the client still
  connects, lists tools and calls them with `/call`.

## Identity provider setup

Register an application for this client at the identity provider:

| Setting | Value |
|---|---|
| Client type | Public (PKCE only) or confidential; both work |
| Grant types | `authorization_code`, `refresh_token` |
| Redirect URL | `http://localhost:8765/idp/callback` (port from `CALLBACK_PORT`) |
| Scopes | `openid`, plus any claims you want in the ID token |
| **ID token audience** | **Must include the client ID the gateway uses at this identity provider** |

The last row is what makes the demo work. The ID-JAG specification requires the
identity provider to check that the ID token's audience matches the client that
authenticates the exchange request, and that client is the gateway. Most
identity providers let an application add extra audiences to its ID tokens;
in WSO2 Identity Server it is the application's *ID token audience* setting.
Add the gateway's identity provider client ID there.

If the refresh token grant returns a new ID token, the client renews it silently
before it expires. Otherwise it opens the browser for a new sign-in.

## Gateway setup

- MCP Authentication policy attached and working for this MCP server. It decides
  which authorization server this client discovers. If that is the same server as
  `IDP_ISSUER`, the two sign-ins will share the browser session; they are still two flows.
- ID-JAG policy attached after it with `assertionType: id_token`,
  `idTokenHeader` equal to `ID_TOKEN_HEADER` here, and a `credentialRef` whose
  identity provider client ID is the one you put in the ID token audience above.

## Running

```bash
npm install
cp .env.example .env     # then edit
npm start
```

What happens:

1. A callback listener starts on `localhost:8765`.
2. The browser opens for sign-in at `IDP_ISSUER`. The terminal prints the ID
   token's issuer, subject, audiences and expiry. The token itself is never printed.
3. The client connects to `MCP_SERVER_URL`, gets a 401 with resource metadata,
   discovers the authorization server, registers or uses the pre-registered
   client, and opens the browser again to authorize. The gateway access token's
   claims are printed the same way.
4. Tools are listed. Each MCP request is logged with its JSON-RPC method, the
   header the ID token went on, and the status. A 401 shows the gateway's
   `WWW-Authenticate` value, which is where a failed exchange is diagnosed.
5. Type a message to chat, or use the commands:

```
/tools                 list the MCP server's tools
/call <tool> [json]    call a tool directly, e.g. /call search {"query":"x"}
/idtoken               show the current ID token claims
/quit                  exit
```

## Configuration

All settings are environment variables, read from `.env` by `npm start`.
See [.env.example](.env.example) for the full list.

| Variable | Purpose |
|---|---|
| `IDP_ISSUER` | Issuer URL of the identity provider; discovery uses `/.well-known/openid-configuration` under it |
| `IDP_CLIENT_ID`, `IDP_CLIENT_SECRET` | The client registered above. Secret empty for a public client |
| `IDP_SCOPES` | Scopes for the sign-in; must include `openid` |
| `MCP_SERVER_URL` | The MCP endpoint on the gateway |
| `MCP_CLIENT_ID`, `MCP_CLIENT_SECRET` | Empty to register dynamically; set for a pre-registered client |
| `MCP_SCOPES` | Fallback scope when the server's metadata advertises none |
| `ID_TOKEN_HEADER` | Header carrying the ID token; default `X-ID-Token` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Chat; optional |
| `CALLBACK_PORT` | Local port for both redirect URLs; default `8765` |
| `LOG_HTTP` | `false` to silence per-request logging |

## What this client does and does not do

- Tokens live in memory for the lifetime of the process. Nothing is written to disk.
- The ID token is sent only to `MCP_SERVER_URL`, never to the authorization
  server traffic the MCP SDK generates, and never logged. Only decoded claims are shown.
- The ID token is renewed before expiry on every request, so the gateway should
  not see an expired one. If it does, or if the exchange fails, the gateway
  answers 401 with `error="invalid_token"` and the SDK re-authorizes.
- PKCE is used on both flows regardless of client type, as the MCP
  authorization specification requires.
- No `private_key_jwt` or DPoP. Both libraries support them; they are left out to keep the sample small.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-in returns no ID token | `openid` missing from `IDP_SCOPES` or not allowed for the client |
| Gateway 401 `invalid_token` on every request after a successful authorize | The identity provider rejected the exchange. Check the ID token audience includes the gateway's client ID, and the gateway's logs for the step that failed |
| Gateway 502 | The exchange with the upstream authorization server failed; see gateway logs |
| `State mismatch` in the browser | A stale callback from an earlier run; retry the sign-in |
| Self-signed TLS at the identity provider or gateway | Set `NODE_EXTRA_CA_CERTS` to the CA bundle |

## Development

```bash
npm run typecheck
npm test
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
