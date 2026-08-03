'use client';

import { useQuery } from '@tanstack/react-query';
import { request } from '@/api-client';
import { queryKeys } from '../keys';

export type Me = {
  id: string;
  username: string;
  display_name?: string;
  email_verified?: boolean;
};

export async function fetchMe(): Promise<Me> {
  const { data } = await request<Me>('/v1/me', {
    baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3000',
  });
  return data;
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: fetchMe,
    enabled,
    staleTime: 60_000,
  });
}
