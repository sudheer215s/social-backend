import * as jose from 'jose';
import { JwtVerifier } from './jwt-verifier';

async function makeSigner() {
  const { privateKey, publicKey } = await jose.generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = 'test-kid';
  jwk.alg = 'EdDSA';
  jwk.use = 'sig';
  const getKey = jose.createLocalJWKSet({ keys: [jwk] });
  return { privateKey, getKey };
}

describe('JwtVerifier', () => {
  it('accepts a valid EdDSA access token', async () => {
    const { privateKey, getKey } = await makeSigner();
    const token = await new jose.SignJWT({ sid: 'sess-1', scope: ['user'] })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-kid' })
      .setIssuer('http://identity')
      .setAudience('api')
      .setSubject('user-1')
      .setExpirationTime('10m')
      .sign(privateKey);

    const verifier = new JwtVerifier({
      jwksUrl: 'http://unused',
      issuer: 'http://identity',
      audience: 'api',
      jwks: getKey,
    });
    await expect(verifier.verify(token)).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'sess-1',
      scope: ['user'],
    });
  });

  it('rejects wrong audience', async () => {
    const { privateKey, getKey } = await makeSigner();
    const token = await new jose.SignJWT({ sid: 's' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-kid' })
      .setIssuer('http://identity')
      .setAudience('other')
      .setSubject('u')
      .setExpirationTime('10m')
      .sign(privateKey);

    const verifier = new JwtVerifier({
      jwksUrl: 'http://unused',
      issuer: 'http://identity',
      audience: 'api',
      jwks: getKey,
    });
    await expect(verifier.verify(token)).rejects.toBeTruthy();
  });
});
