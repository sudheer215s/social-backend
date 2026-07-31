import * as jose from 'jose';

export interface AccessPrincipal {
  userId: string;
  sessionId: string;
  scope: string[];
}

export interface JwtVerifierOptions {
  jwksUrl: string;
  issuer: string;
  audience: string;
  /** Override for tests (inject fixed JWKS). */
  jwks?: jose.JWTVerifyGetKey;
}

/**
 * Verifies EdDSA access tokens against identity JWKS (gateway never signs).
 */
export class JwtVerifier {
  private readonly getKey: jose.JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(options: JwtVerifierOptions) {
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.getKey =
      options.jwks ??
      jose.createRemoteJWKSet(new URL(options.jwksUrl), {
        cooldownDuration: 30_000,
      });
  }

  async verify(token: string): Promise<AccessPrincipal> {
    const { payload } = await jose.jwtVerify(token, this.getKey, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['EdDSA'],
    });
    const userId = payload.sub;
    const sessionId = payload.sid;
    if (typeof userId !== 'string' || typeof sessionId !== 'string') {
      throw new Error('token missing sub/sid');
    }
    const scope = Array.isArray(payload.scope)
      ? payload.scope.filter((s): s is string => typeof s === 'string')
      : [];
    return { userId, sessionId, scope };
  }
}
