import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2';
import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { tanstackStartCookies } from 'better-auth/tanstack-start';

import { ENV } from '@canary/auth/env';
import { createDb } from '@canary/db';
import * as schema from '@canary/db/schema/auth';

export function createAuth() {
  return betterAuth({
    advanced: {
      database: {
        joins: true,
      },
    },
    database: drizzleAdapter(createDb(), {
      provider: 'pg',
      schema,
    }),
    trustedOrigins: origins(),
    emailAndPassword: {
      enabled: true,
    },
    secret: ENV.BETTER_AUTH_SECRET,
    baseURL: ENV.BETTER_AUTH_URL,
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: '/login',
        consentPage: '/consent',
        scopes: ['openid', 'profile', 'email', 'offline_access', 'mcp:tools'],
        validAudiences: [ENV.BETTER_AUTH_URL, ENV.CANARY_MCP_URL ?? ENV.BETTER_AUTH_URL],
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
      ENV.CORS_ORIGIN,
      ENV.BETTER_AUTH_URL,
      ...(ENV.APP_ENV === 'development' ? ['http://localhost:3001', 'https://localhost:3443'] : []),
    ]),
  );
}
