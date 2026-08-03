import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { IdentityAuthedRequest } from './jwt-auth.guard';

/**
 * Allows only user IDs listed in ADMIN_USER_IDS (comma-separated UUIDs).
 * Empty / unset → all admin routes return 403 (fail closed).
 */
export function parseAdminUserIds(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const raw = env.ADMIN_USER_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<IdentityAuthedRequest>();
    const userId = req.userId;
    if (!userId) {
      throw new ForbiddenException('Admin access required');
    }
    const admins = parseAdminUserIds();
    if (!admins.has(userId)) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
