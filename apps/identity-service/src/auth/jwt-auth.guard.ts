import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtKeyRing } from '../tokens/jwt-keys';

export type IdentityAuthedRequest = Request & {
  userId?: string;
  sessionId?: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly keys: JwtKeyRing) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IdentityAuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const verified = await this.keys.verifyAccessToken(token);
      req.userId = verified.sub;
      req.sessionId = verified.sid;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
