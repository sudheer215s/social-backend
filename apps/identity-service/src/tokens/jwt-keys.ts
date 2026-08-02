import * as jose from 'jose';
import { createHash, randomBytes } from 'node:crypto';

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60; // 10 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface AccessClaims {
  sub: string;
  sid: string;
  scope: string[];
  /** Whether the user has verified their email (write-path gating). */
  emailVerified: boolean;
}

export interface VerifiedAccess {
  sub: string;
  sid: string;
  jti: string;
  scope: string[];
  emailVerified: boolean;
  exp: number;
  iat: number;
}

export interface KeyPairEntry {
  kid: string;
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
  publicJwk: jose.JWK;
}

export class JwtKeyRing {
  constructor(
    private current: KeyPairEntry,
    private previous: KeyPairEntry | undefined,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  get currentKid(): string {
    return this.current.kid;
  }

  /** JWKS document for gateways / resource servers. */
  toJwks(): { keys: jose.JWK[] } {
    const keys = [this.current.publicJwk];
    if (this.previous) {
      keys.push(this.previous.publicJwk);
    }
    return { keys };
  }

  async signAccessToken(claims: AccessClaims): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new jose.SignJWT({
      sid: claims.sid,
      scope: claims.scope,
      email_verified: claims.emailVerified,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.current.kid, typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setSubject(claims.sub)
      .setJti(randomJti())
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.current.privateKey);
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccess> {
    const keys = [this.current, this.previous].filter(
      (k): k is KeyPairEntry => k !== undefined,
    );
    let lastErr: unknown;
    for (const key of keys) {
      try {
        const { payload } = await jose.jwtVerify(token, key.publicKey, {
          issuer: this.issuer,
          audience: this.audience,
          algorithms: ['EdDSA'],
        });
        const sub = payload.sub;
        const sid = payload.sid;
        const jti = payload.jti;
        if (
          typeof sub !== 'string' ||
          typeof sid !== 'string' ||
          typeof jti !== 'string'
        ) {
          throw new Error('missing required claims');
        }
        const scope = Array.isArray(payload.scope)
          ? payload.scope.filter((s): s is string => typeof s === 'string')
          : [];
        return {
          sub,
          sid,
          jti,
          scope,
          emailVerified: payload.email_verified === true,
          exp: payload.exp ?? 0,
          iat: payload.iat ?? 0,
        };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('invalid token');
  }

  /**
   * Promote a newly generated key to signing; previous becomes verify-only.
   * Used by tests and future rotation jobs.
   */
  rotate(next: KeyPairEntry): void {
    this.previous = {
      kid: this.current.kid,
      privateKey: this.current.privateKey,
      publicKey: this.current.publicKey,
      publicJwk: this.current.publicJwk,
    };
    this.current = next;
  }
}

export async function generateEd25519KeyPair(
  kid: string = randomKid(),
): Promise<KeyPairEntry> {
  const { privateKey, publicKey } = await jose.generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = 'EdDSA';
  publicJwk.use = 'sig';
  return { kid, privateKey, publicKey, publicJwk };
}

export async function createDevKeyRing(options?: {
  issuer?: string;
  audience?: string;
}): Promise<JwtKeyRing> {
  const current = await generateEd25519KeyPair('dev-current');
  return new JwtKeyRing(
    current,
    undefined,
    options?.issuer ?? process.env.JWT_ISSUER ?? 'http://localhost:3001',
    options?.audience ?? process.env.JWT_AUDIENCE ?? 'api',
  );
}

export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function mintRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

function randomKid(): string {
  return randomBytes(8).toString('hex');
}

function randomJti(): string {
  return randomBytes(16).toString('hex');
}
