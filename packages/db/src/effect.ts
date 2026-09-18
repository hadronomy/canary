import { createInsertSchema, createSelectSchema } from 'drizzle-orm/effect-schema';

import { message, part, run, thread } from '@canary/db/schema/app';

export const schema = {
  message: {
    insert: createInsertSchema(message),
    select: createSelectSchema(message),
  },
  part: {
    select: createSelectSchema(part),
  },
  run: {
    select: createSelectSchema(run),
  },
  thread: {
    insert: createInsertSchema(thread),
    select: createSelectSchema(thread),
  },
};
