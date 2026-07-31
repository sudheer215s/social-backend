import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SidRevocationStore } from '@social/platform-redis';
import { JwtVerifier, type AccessPrincipal } from './jwt-verifier';

export type AuthedRequest = Request & { user?: AccessPrincipal };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly verifier: JwtVerifier,
    private readonly revocation: SidRevocationStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const principal = await this.verifier.verify(token);
      if (await this.revocation.isRevoked(principal.sessionId)) {
        throw new UnauthorizedException('Session revoked');
      }
      req.user = principal;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
