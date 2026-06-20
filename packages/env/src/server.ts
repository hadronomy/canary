import 'dotenv/config';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    AGENT_MODEL: z.string().default('openai/gpt-4.1-mini'),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CANARY_MCP_URL: z.url().optional(),
    CORS_ORIGIN: z.url(),
    DATABASE_URL: z.url(),
    ELECTRIC_SECRET: z.string().optional(),
    ELECTRIC_URL: z.url(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    OPENAI_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
