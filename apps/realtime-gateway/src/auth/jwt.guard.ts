import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import * as jose from 'jose';

export type AuthedRequest = Request & {
  userId?: string;
  sessionId?: string;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private getKey: jose.JWTVerifyGetKey;

  constructor() {
    this.getKey = jose.createRemoteJWKSet(
      new URL(
        process.env.IDENTITY_JWKS_URL ??
          'http://127.0.0.1:3001/.well-known/jwks.json',
      ),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const { payload } = await jose.jwtVerify(
        header.slice(7).trim(),
        this.getKey,
        {
          issuer: process.env.JWT_ISSUER ?? 'http://localhost:3001',
          audience: process.env.JWT_AUDIENCE ?? 'api',
          algorithms: ['EdDSA'],
        },
      );
      if (typeof payload.sub !== 'string') throw new Error('no sub');
      req.userId = payload.sub;
      if (typeof payload.sid === 'string') {
        req.sessionId = payload.sid;
      }
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
