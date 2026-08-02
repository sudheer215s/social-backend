import { UnauthorizedException } from '@nestjs/common';
import { MemorySidRevocationStore } from '@social/platform-redis';
import { AuthGuard } from './auth.guard';
import type { JwtVerifier } from './jwt-verifier';

describe('AuthGuard revocation', () => {
  it('rejects revoked session ids', async () => {
    const verifier = {
      verify: jest.fn().mockResolvedValue({
        userId: 'u1',
        sessionId: 's1',
        scope: ['user'],
        emailVerified: true,
      }),
    } as unknown as JwtVerifier;
    const revocation = new MemorySidRevocationStore();
    await revocation.revoke('s1');
    const guard = new AuthGuard(verifier, revocation);
    const req = {
      headers: { authorization: 'Bearer tok' },
    };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows valid non-revoked sessions', async () => {
    const verifier = {
      verify: jest.fn().mockResolvedValue({
        userId: 'u1',
        sessionId: 's2',
        scope: ['user'],
        emailVerified: true,
      }),
    } as unknown as JwtVerifier;
    const revocation = new MemorySidRevocationStore();
    const guard = new AuthGuard(verifier, revocation);
    const req: { headers: { authorization: string }; user?: unknown } = {
      headers: { authorization: 'Bearer tok' },
    };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
      } as never),
    ).resolves.toBe(true);
    expect(req.user).toMatchObject({ sessionId: 's2' });
  });
});
