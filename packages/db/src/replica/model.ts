import type { PgTable } from 'drizzle-orm/pg-core';

import { event, message, part, run, thread } from '#schema/app';
import { getColumns, getTableName } from 'drizzle-orm';
import { createSchemaFactory } from 'drizzle-orm/zod';
import { z } from 'zod/v4';

const fields = z.record(z.string(), z.unknown());
const factory = createSchemaFactory({
  coerce: { date: true },
});

const Thread = define({
  name: 'threads',
  table: thread,
  schema: factory.createSelectSchema(thread),
  where: `${thread.ownerId.name} = $1 and ${thread.archivedAt.name} is null`,
});

const Message = define({
  name: 'messages',
  table: message,
  schema: factory.createSelectSchema(message, {
    metadata: fields.nullable(),
  }),
  where: `${message.ownerId.name} = $1`,
});

const Run = define({
  name: 'runs',
  table: run,
  schema: factory.createSelectSchema(run),
  where: `${run.ownerId.name} = $1`,
});

const Event = define({
  name: 'events',
  table: event,
  schema: factory.createSelectSchema(event, {
    data: fields.nullable(),
  }),
  where: `${event.ownerId.name} = $1`,
});

const Part = define({
  name: 'parts',
  table: part,
  schema: factory.createSelectSchema(part, {
    data: fields.nullable(),
  }),
  where: `${part.ownerId.name} = $1`,
});

export const model = {
  Thread,
  Message,
  Run,
  Event,
  Part,
  all: [Thread, Message, Run, Event, Part],
} as const;

function define<const Name extends string, Table extends PgTable, Schema extends z.ZodType>(spec: {
  readonly name: Name;
  readonly schema: Schema;
  readonly table: Table;
  readonly where: string;
}) {
  return Object.freeze({
    columns: Object.freeze(Object.values(getColumns(spec.table)).map((column) => column.name)),
    name: spec.name,
    schema: spec.schema,
    table: getTableName(spec.table),
    where: spec.where,
  });
}
