import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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

export const thread = pgTable(
  'thread',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('thread_owner_updated_idx').on(table.ownerId, table.updatedAt),
    index('thread_owner_archived_idx').on(table.ownerId, table.archivedAt),
  ],
);

export const member = pgTable(
  'thread_member',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('owner').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('thread_member_thread_idx').on(table.threadId),
    index('thread_member_user_idx').on(table.userId),
  ],
);

export const message = pgTable(
  'message',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    runId: uuid('run_id'),
    role: role('role').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('message_thread_created_idx').on(table.threadId, table.createdAt),
    index('message_owner_thread_idx').on(table.ownerId, table.threadId),
  ],
);

export const run = pgTable(
  'run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    inputMessageId: uuid('input_message_id').references(() => message.id, { onDelete: 'set null' }),
    status: status('status').default('queued').notNull(),
    model: text('model').notNull(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
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

export const event = pgTable(
  'run_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('run_event_run_seq_unique').on(table.runId, table.seq),
    index('run_event_run_seq_idx').on(table.runId, table.seq),
    index('run_event_thread_created_idx').on(table.threadId, table.createdAt),
  ],
);

export const part = pgTable(
  'message_part',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id').references(() => message.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: partKind('kind').notNull(),
    status: partStatus('status').default('pending').notNull(),
    toolName: text('tool_name'),
    content: text('content').default('').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
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

export const artifact = pgTable(
  'artifact',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => thread.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => run.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('artifact_thread_created_idx').on(table.threadId, table.createdAt),
    index('artifact_owner_kind_idx').on(table.ownerId, table.kind),
  ],
);

export const cache = pgTable('agent_cache', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const cacheList = pgTable(
  'agent_cache_list',
  {
    key: text('key').notNull(),
    idx: integer('idx').notNull(),
    value: jsonb('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.idx] })],
);

export const cacheCounter = pgTable('agent_cache_counter', {
  key: text('key').primaryKey(),
  value: integer('value').default(0).notNull(),
});
