import { Controller, NotFoundException } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { UsersService } from '../users/users.service';

@Controller()
export class IdentityGrpcController {
  constructor(private readonly users: UsersService) {}

  @GrpcMethod('IdentityService', 'GetUser')
  async getUser(data: { user_id: string }) {
    try {
      const user = await this.users.getById(data.user_id);
      return toProto(user);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new RpcException({
          code: GrpcStatus.NOT_FOUND,
          message: 'User not found',
        });
      }
      throw err;
    }
  }

  @GrpcMethod('IdentityService', 'GetUserByUsername')
  async getUserByUsername(data: { username: string }) {
    try {
      const user = await this.users.getPublicByUsername(data.username);
      return {
        id: user.id,
        username: user.username,
        email: '',
        email_verified: false,
        display_name: user.displayName ?? '',
        bio: user.bio ?? '',
        avatar_media_id: user.avatarMediaId ?? '',
        visibility: user.visibility,
        status: user.status,
        is_verified: user.isVerified,
        follower_count: user.followerCount,
        following_count: user.followingCount,
        post_count: user.postCount,
      };
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new RpcException({
          code: GrpcStatus.NOT_FOUND,
          message: 'User not found',
        });
      }
      throw err;
    }
  }
}

function toProto(user: {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  bio: string | null;
  avatarMediaId: string | null;
  visibility: string;
  status: string;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    email_verified: user.emailVerified,
    display_name: user.displayName ?? '',
    bio: user.bio ?? '',
    avatar_media_id: user.avatarMediaId ?? '',
    visibility: user.visibility,
    status: user.status,
    is_verified: user.isVerified,
    follower_count: user.followerCount,
    following_count: user.followingCount,
    post_count: user.postCount,
  };
}
