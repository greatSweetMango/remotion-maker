import type { DefaultSession } from 'next-auth';
import type { Tier } from '@/types';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      tier: Tier;
    };
  }
}
