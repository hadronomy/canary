import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt } from 'better-auth/plugins';
import { tanstackStartCookies } from 'better-auth/tanstack-start';

import { createDb } from '@canary/db';
import * as schema from '@canary/db/schema/auth';
import { env } from '@canary/env/server';

export function createAuth() {
  return betterAuth({
    database: drizzleAdapter(createDb(), {
      provider: 'pg',
      schema,
    }),
    trustedOrigins: origins(),
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: '/login',
        consentPage: '/consent',
        scopes: ['openid', 'profile', 'email', 'offline_access', 'mcp:tools'],
        validAudiences: [env.BETTER_AUTH_URL, env.CANARY_MCP_URL ?? env.BETTER_AUTH_URL],
        allowDynamicClientRegistration: true,
      }),
      tanstackStartCookies(),
    ],
  });
}

export const auth = createAuth();

function origins() {
  return Array.from(
    new Set([
      env.CORS_ORIGIN,
      env.BETTER_AUTH_URL,
      ...(env.NODE_ENV === 'development'
        ? ['http://localhost:3001', 'https://localhost:3443']
        : []),
    ]),
  );
}
