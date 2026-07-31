import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  ClientGrpc,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { firstValueFrom, type Observable } from 'rxjs';

export interface GrpcUser {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  display_name: string;
  bio: string;
  avatar_media_id: string;
  visibility: string;
  status: string;
  is_verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
}

interface IdentityGrpc {
  getUser(data: { user_id: string }): Observable<GrpcUser>;
  getUserByUsername(data: { username: string }): Observable<GrpcUser>;
}

function resolveProto(): string {
  const candidates = [
    join(process.cwd(), 'proto/identity/v1/identity.proto'),
    join(process.cwd(), '../../proto/identity/v1/identity.proto'),
    join(__dirname, '../../../../proto/identity/v1/identity.proto'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

export class IdentityGrpcClient {
  private readonly client: ClientGrpc;
  private svc: IdentityGrpc | undefined;

  constructor(
    url: string = process.env.IDENTITY_GRPC_URL ?? '127.0.0.1:50051',
  ) {
    this.client = ClientProxyFactory.create({
      transport: Transport.GRPC,
      options: {
        package: 'identity.v1',
        protoPath: resolveProto(),
        url,
      },
    });
  }

  private service(): IdentityGrpc {
    if (!this.svc) {
      this.svc = this.client.getService<IdentityGrpc>('IdentityService');
    }
    return this.svc;
  }

  async getUser(userId: string): Promise<GrpcUser> {
    return firstValueFrom(this.service().getUser({ user_id: userId }));
  }
}
