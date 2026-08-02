import {
  createDevKeyRing,
  generateEd25519KeyPair,
  hashRefreshToken,
  mintRefreshToken,
} from './jwt-keys';

describe('JwtKeyRing', () => {
  it('signs and verifies an access token with EdDSA', async () => {
    const ring = await createDevKeyRing({
      issuer: 'http://test',
      audience: 'api',
    });
    const token = await ring.signAccessToken({
      sub: 'user-1',
      sid: 'session-1',
      scope: ['user'],
      emailVerified: true,
    });
    const verified = await ring.verifyAccessToken(token);
    expect(verified.sub).toBe('user-1');
    expect(verified.sid).toBe('session-1');
    expect(verified.scope).toEqual(['user']);
    expect(verified.emailVerified).toBe(true);
    expect(verified.exp).toBeGreaterThan(verified.iat);
  });

  it('exposes JWKS with kid and rejects garbage tokens', async () => {
    const ring = await createDevKeyRing();
    const jwks = ring.toJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]?.kid).toBe(ring.currentKid);
    expect(jwks.keys[0]?.alg).toBe('EdDSA');
    await expect(ring.verifyAccessToken('not.a.jwt')).rejects.toBeTruthy();
  });

  it('still verifies tokens after rotation with previous key', async () => {
    const ring = await createDevKeyRing({
      issuer: 'http://test',
      audience: 'api',
    });
    const token = await ring.signAccessToken({
      sub: 'u',
      sid: 's',
      scope: ['user'],
      emailVerified: false,
    });
    const next = await generateEd25519KeyPair('dev-next');
    ring.rotate(next);
    await expect(ring.verifyAccessToken(token)).resolves.toMatchObject({
      sub: 'u',
      sid: 's',
      emailVerified: false,
    });
    const fresh = await ring.signAccessToken({
      sub: 'u2',
      sid: 's2',
      scope: ['user'],
      emailVerified: true,
    });
    await expect(ring.verifyAccessToken(fresh)).resolves.toMatchObject({
      sub: 'u2',
      emailVerified: true,
    });
  });
});

describe('refresh token helpers', () => {
  it('mints opaque tokens and hashes them with sha256', () => {
    const a = mintRefreshToken();
    const b = mintRefreshToken();
    expect(a).not.toBe(b);
    expect(hashRefreshToken(a)).toHaveLength(32);
    expect(hashRefreshToken(a).equals(hashRefreshToken(a))).toBe(true);
  });
});
