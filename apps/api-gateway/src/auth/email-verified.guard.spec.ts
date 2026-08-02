import { ForbiddenException } from '@nestjs/common';
import {
  EMAIL_NOT_VERIFIED_TYPE,
  EmailVerifiedGuard,
  shouldEnforceEmailVerified,
} from './email-verified.guard';

describe('EmailVerifiedGuard', () => {
  it('shouldEnforceEmailVerified respects env', () => {
    expect(shouldEnforceEmailVerified({ ENFORCE_EMAIL_VERIFIED: '1' })).toBe(
      true,
    );
    expect(shouldEnforceEmailVerified({ ENFORCE_EMAIL_VERIFIED: '0' })).toBe(
      false,
    );
    expect(
      shouldEnforceEmailVerified({
        NODE_ENV: 'production',
        ENFORCE_EMAIL_VERIFIED: undefined,
      }),
    ).toBe(true);
    expect(
      shouldEnforceEmailVerified({
        NODE_ENV: 'development',
        ENFORCE_EMAIL_VERIFIED: undefined,
      }),
    ).toBe(false);
  });

  it('allows verified users when enforced', () => {
    process.env.ENFORCE_EMAIL_VERIFIED = '1';
    const guard = new EmailVerifiedGuard();
    const req = { user: { emailVerified: true } };
    expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
      } as never),
    ).toBe(true);
    delete process.env.ENFORCE_EMAIL_VERIFIED;
  });

  it('rejects unverified with stable problem type', () => {
    process.env.ENFORCE_EMAIL_VERIFIED = '1';
    const guard = new EmailVerifiedGuard();
    const req = { user: { emailVerified: false } };
    try {
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
      } as never);
      fail('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse() as {
        type: string;
        status: number;
      };
      expect(body.type).toBe(EMAIL_NOT_VERIFIED_TYPE);
      expect(body.status).toBe(403);
    }
    delete process.env.ENFORCE_EMAIL_VERIFIED;
  });
});
