import { defineConfig } from 'drizzle-kit';

import { ENV } from '@canary/db/env';

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/schema/index.ts',
  dbCredentials: {
    url: ENV.DATABASE_URL,
  },
});
