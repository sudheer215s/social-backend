import { Module } from '@nestjs/common';
import { HealthService } from '@social/platform-telemetry';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { JwtVerifier } from './auth/jwt-verifier';
import { HealthController } from './health.controller';
import { IdentityProxy } from './proxy/identity.proxy';

@Module({
  controllers: [AuthController, HealthController],
  providers: [
    {
      provide: HealthService,
      useFactory: () => new HealthService({ probes: [] }),
    },
    {
      provide: JwtVerifier,
      useFactory: () =>
        new JwtVerifier({
          jwksUrl:
            process.env.IDENTITY_JWKS_URL ??
            'http://127.0.0.1:3001/.well-known/jwks.json',
          issuer: process.env.JWT_ISSUER ?? 'http://localhost:3001',
          audience: process.env.JWT_AUDIENCE ?? 'api',
        }),
    },
    {
      provide: IdentityProxy,
      useFactory: () =>
        new IdentityProxy(
          process.env.IDENTITY_BASE_URL ?? 'http://127.0.0.1:3001',
        ),
    },
    AuthGuard,
  ],
})
export class AppModule {}
