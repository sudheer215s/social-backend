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
  sessionId?: string | undefined;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private getKey: jose.JWTVerifyGetKey;

  constructor() {
    const jwksUrl =
      process.env.IDENTITY_JWKS_URL ??
      'http://127.0.0.1:3001/.well-known/jwks.json';
    this.getKey = jose.createRemoteJWKSet(new URL(jwksUrl));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7).trim();
    try {
      const { payload } = await jose.jwtVerify(token, this.getKey, {
        issuer: process.env.JWT_ISSUER ?? 'http://localhost:3001',
        audience: process.env.JWT_AUDIENCE ?? 'api',
        algorithms: ['EdDSA'],
      });
      if (typeof payload.sub !== 'string') {
        throw new Error('missing sub');
      }
      req.userId = payload.sub;
      req.sessionId = typeof payload.sid === 'string' ? payload.sid : undefined;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
