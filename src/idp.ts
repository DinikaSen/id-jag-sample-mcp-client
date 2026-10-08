import * as oidc from 'openid-client';
import type { IdpConfig } from './config.js';
import { CallbackServer } from './callback-server.js';
import { openInBrowser } from './browser.js';
import { describeToken, log } from './log.js';

const RENEW_BEFORE_EXPIRY_SECONDS = 30;

/**
 * Signs the user in at the configured OpenID Connect identity provider and keeps the
 * ID token fresh. The ID token is what the gateway exchanges for an ID-JAG, so it is
 * the only artefact of this sign-in that leaves the app.
 *
 * Renewal order: refresh token grant when the provider issued one, otherwise a new
 * interactive sign-in.
 */
export class IdentityProviderSession {
  private config?: oidc.Configuration;
  private idToken?: string;
  private idTokenExp = 0;
  private refreshToken?: string;
  private inflight?: Promise<string>;

  constructor(
    private readonly idp: IdpConfig,
    private readonly callbacks: CallbackServer,
  ) {}

  async discover(): Promise<void> {
    const auth = this.idp.clientSecret ? oidc.ClientSecretBasic(this.idp.clientSecret) : oidc.None();
    const metadata = this.idp.clientSecret ? { client_secret: this.idp.clientSecret } : undefined;
    const options: oidc.DiscoveryRequestOptions =
      this.idp.issuer.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : {};
    this.config = await oidc.discovery(this.idp.issuer, this.idp.clientId, metadata, auth, options);
    const meta = this.config.serverMetadata();
    log.ok(`identity provider discovered: ${meta.issuer} (${this.idp.clientSecret ? 'confidential' : 'public'} client)`);
  }

  /** Returns a valid ID token, renewing it first when it is about to expire. */
  async currentIdToken(): Promise<string> {
    if (this.idToken && Date.now() / 1000 < this.idTokenExp - RENEW_BEFORE_EXPIRY_SECONDS) {
      return this.idToken;
    }
    if (!this.inflight) {
      this.inflight = this.renew().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  claims(): Record<string, unknown> | undefined {
    if (!this.idToken) {
      return undefined;
    }
    const payload = this.idToken.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  }

  private async renew(): Promise<string> {
    if (this.refreshToken) {
      try {
        const tokens = await oidc.refreshTokenGrant(this.requireConfig(), this.refreshToken);
        if (tokens.id_token) {
          this.store(tokens);
          log.ok('ID token renewed with the refresh token grant');
          return this.idToken!;
        }
        log.warn('refresh grant returned no ID token; signing in again');
      } catch (err) {
        log.warn(`refresh grant failed (${(err as Error).message}); signing in again`);
      }
      this.refreshToken = undefined;
    }
    return this.signIn();
  }

  async signIn(): Promise<string> {
    const config = this.requireConfig();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.idp.redirectUrl,
      scope: this.idp.scopes,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    const callback = this.callbacks.waitFor('/idp/callback', state);
    openInBrowser(authorizationUrl, 'Sign in at the identity provider');
    const callbackUrl = await callback;

    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    if (!tokens.id_token) {
      throw new Error('the identity provider returned no ID token; is the openid scope allowed for this client?');
    }
    this.store(tokens);
    log.ok(describeToken('ID token', this.idToken!));
    return this.idToken!;
  }

  private store(tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers): void {
    this.idToken = tokens.id_token;
    this.idTokenExp = Number(tokens.claims()?.exp ?? 0);
    if (tokens.refresh_token) {
      this.refreshToken = tokens.refresh_token;
    }
  }

  private requireConfig(): oidc.Configuration {
    if (!this.config) {
      throw new Error('identity provider not discovered yet');
    }
    return this.config;
  }
}
