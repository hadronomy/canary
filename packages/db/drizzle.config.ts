import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

import { env } from '@canary/env/server';

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/schema/index.ts',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
