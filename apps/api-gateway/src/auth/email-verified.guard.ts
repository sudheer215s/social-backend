import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthedRequest } from './auth.guard';

/**
 * Write-path gate: unverified accounts may read but not post/follow/like
 * (identity design §4.1, frontend review F10).
 *
 * Returns RFC 9457 problem with a stable type so clients can show UnverifiedGate
 * without string-matching titles.
 *
 * Enforcement is on when:
 * - `ENFORCE_EMAIL_VERIFIED=1`, or
 * - `NODE_ENV=production` and `ENFORCE_EMAIL_VERIFIED` is not `0`
 *
 * Local smoke/dev defaults to off so register → post journeys still work.
 */
export const EMAIL_NOT_VERIFIED_TYPE =
  'https://api.social.example.com/problems/email-not-verified';

export function shouldEnforceEmailVerified(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.ENFORCE_EMAIL_VERIFIED === '1') return true;
  if (env.ENFORCE_EMAIL_VERIFIED === '0') return false;
  return env.NODE_ENV === 'production';
}

@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!shouldEnforceEmailVerified()) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.user?.emailVerified === true) {
      return true;
    }
    throw new ForbiddenException({
      type: EMAIL_NOT_VERIFIED_TYPE,
      title: 'Email not verified',
      status: 403,
      detail: 'Verify your email before performing this action.',
    });
  }
}
