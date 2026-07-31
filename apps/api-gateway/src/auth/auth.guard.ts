import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtVerifier, type AccessPrincipal } from './jwt-verifier';

export type AuthedRequest = Request & { user?: AccessPrincipal };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly verifier: JwtVerifier) {}

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
      req.user = await this.verifier.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
