import {
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  snakeCase,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';

export const role = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);
export const partKind = pgEnum('message_part_kind', [
  'text',
  'reasoning',
  'tool-call',
  'tool-result',
  'artifact',
  'error',
  'status',
]);
export const partStatus = pgEnum('message_part_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export const status = pgEnum('run_status', [
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
]);

export const thread = snakeCase.table(
  'thread',
  {
    id: uuid().defaultRandom().primaryKey(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    // Settled threads are done with, and sit in their own section at the foot
    // of the list. A snoozed one is out of the way until `snoozedUntil`, and
    // comes back on its own once that passes. A new message clears both.
    settledAt: timestamp({ withTimezone: true }),
    snoozedUntil: timestamp({ withTimezone: true }),
    // The OpenRouter model the thread answers with. Null until one is chosen,
    // which reads as the catalog's default: the default lives with the
    // catalog, not in the schema.
    model: text(),
  },
  (table) => [index('thread_owner_updated_idx').on(table.ownerId, table.updatedAt)],
);

export const member = snakeCase.table(
  'thread_member',
  {
    id: uuid().defaultRandom().primaryKey(),
    threadId: uuid()
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text().default('owner').notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('thread_member_thread_idx').on(table.threadId),
    index('thread_member_user_idx').on(table.userId),
  ],
);

export const message = snakeCase.table(
  'message',
  {
    id: uuid().defaultRandom().primaryKey(),
    threadId: uuid()
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    runId: uuid(),
    role: role().notNull(),
    content: text().notNull(),
    // For a user message, the model it was sent to; for an answer, the model
    // that wrote it.
    model: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('message_thread_created_idx').on(table.threadId, table.createdAt),
    index('message_owner_thread_idx').on(table.ownerId, table.threadId),
  ],
);

export const run = snakeCase.table(
  'run',
  {
    id: uuid().defaultRandom().primaryKey(),
    threadId: uuid()
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    inputMessageId: uuid().references(() => message.id, { onDelete: 'set null' }),
    status: status().default('queued').notNull(),
    model: text().notNull(),
    error: text(),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('run_input_message_idx').on(table.inputMessageId),
    index('run_thread_created_idx').on(table.threadId, table.createdAt),
    index('run_owner_status_idx').on(table.ownerId, table.status),
  ],
);

export const event = snakeCase.table(
  'run_event',
  {
    id: uuid().defaultRandom().primaryKey(),
    runId: uuid()
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    threadId: uuid()
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    type: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('run_event_run_seq_unique').on(table.runId, table.seq),
    index('run_event_run_seq_idx').on(table.runId, table.seq),
    index('run_event_thread_created_idx').on(table.threadId, table.createdAt),
  ],
);

export const part = snakeCase.table(
  'message_part',
  {
    id: uuid().defaultRandom().primaryKey(),
    messageId: uuid().references(() => message.id, { onDelete: 'cascade' }),
    runId: uuid()
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    threadId: uuid()
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    kind: partKind().notNull(),
    status: partStatus().default('pending').notNull(),
    toolName: text(),
    content: text().default('').notNull(),
    data: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('message_part_run_seq_unique').on(table.runId, table.seq),
    index('message_part_thread_seq_idx').on(table.threadId, table.seq),
    index('message_part_owner_thread_idx').on(table.ownerId, table.threadId),
  ],
);

export const artifact = snakeCase.table(
  'artifact',
  {
    id: uuid().defaultRandom().primaryKey(),
    threadId: uuid()
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    runId: uuid().references(() => run.id, { onDelete: 'set null' }),
    kind: text().notNull(),
    title: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('artifact_thread_created_idx').on(table.threadId, table.createdAt),
    index('artifact_owner_kind_idx').on(table.ownerId, table.kind),
  ],
);

export const cache = snakeCase.table('agent_cache', {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  expiresAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const cacheList = snakeCase.table(
  'agent_cache_list',
  {
    key: text().notNull(),
    idx: integer().notNull(),
    value: jsonb().$type<unknown>().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.idx] })],
);

export const cacheCounter = snakeCase.table('agent_cache_counter', {
  key: text().primaryKey(),
  value: integer().default(0).notNull(),
});
