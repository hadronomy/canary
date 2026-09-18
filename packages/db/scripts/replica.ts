import { model } from '#replica/model';
import { check, generate } from 'drizzle-kit/cli';
import { formatToMillis } from 'drizzle-orm/migrator.utils';
import { Effect, Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';

const Entry = Schema.StructWithRest(
  Schema.Struct({
    entityType: Schema.String,
    name: Schema.String,
    schema: Schema.optionalKey(Schema.String),
    table: Schema.optionalKey(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
const Column = Schema.StructWithRest(
  Schema.Struct({
    default: Schema.Unknown,
    dimensions: Schema.Number,
    entityType: Schema.Literal('columns'),
    generated: Schema.Unknown,
    identity: Schema.Unknown,
    name: Schema.String,
    notNull: Schema.Boolean,
    schema: Schema.String,
    table: Schema.String,
    type: Schema.String,
    typeSchema: Schema.NullOr(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
const Snapshot = Schema.Struct({
  ddl: Schema.Array(Entry),
  dialect: Schema.Literal('postgres'),
  id: Schema.String,
  prevIds: Schema.Array(Schema.String),
  version: Schema.String,
});
type Snapshot = typeof Snapshot.Type;

type Source = {
  readonly folder: string;
  readonly json: string;
  readonly path: URL;
  readonly snapshot: Snapshot;
  readonly sql: string;
  readonly timestamp: number;
};

type Mode = 'check' | 'generate' | 'write';

export class Failure extends Schema.TaggedError<Failure>()('ReplicaCodegenFailure', {
  operation: Schema.String,
  path: Schema.String,
  reason: Schema.String,
}) {}

const algorithm = 'sha256-canonical-json-v2';
const rootId = '00000000-0000-0000-0000-000000000000';
const root = new URL('../drizzle/', import.meta.url);
const config = new URL('../drizzle.config.ts', import.meta.url);
const target = new URL('../src/replica/manifest.generated.ts', import.meta.url);

const read = Effect.fn('ReplicaCodegen.read')(function* (file: string) {
  const path = new URL(file, root);
  const json = yield* contents(path);
  const input = yield* Effect.try({
    try: () => JSON.parse(json),
    catch: (cause) => failure('parse', path, cause),
  });
  const snapshot = yield* Schema.decodeUnknownEffect(Snapshot)(input).pipe(
    Effect.mapError((cause) => failure('decode', path, cause)),
  );
  const folder = file.slice(0, file.indexOf('/'));
  const sql = yield* contents(new URL(`${folder}/migration.sql`, root));
  const stamp = yield* Effect.try({
    try: () => timestamp(folder),
    catch: (cause) => failure('timestamp', path, cause),
  });

  return { folder, json, path, snapshot, sql, timestamp: stamp } satisfies Source;
});

const discover = Effect.fn('ReplicaCodegen.discover')(function* () {
  const files = yield* Effect.tryPromise({
    try: () =>
      Array.fromAsync(
        new Bun.Glob('*/snapshot.json').scan({
          cwd: fileURLToPath(root),
          onlyFiles: true,
        }),
      ),
    catch: (cause) => failure('discover', root, cause),
  });

  if (!files.length) {
    return yield* new Failure({
      operation: 'discover',
      path: fileURLToPath(root),
      reason: 'No Drizzle snapshot found.',
    });
  }

  return yield* Effect.forEach(files.toSorted(), read);
});

const resolve = Effect.fn('ReplicaCodegen.resolve')(function* (sources: ReadonlyArray<Source>) {
  const ids = new Map(sources.map((source) => [source.snapshot.id, source]));

  if (ids.size !== sources.length) {
    return yield* new Failure({
      operation: 'resolve',
      path: fileURLToPath(root),
      reason: 'Drizzle snapshots contain duplicate IDs.',
    });
  }

  const missing = sources.flatMap((source) =>
    source.snapshot.prevIds
      .filter((id) => id !== rootId && !ids.has(id))
      .map((id) => `${source.folder} -> ${id}`),
  );

  if (missing.length) {
    return yield* new Failure({
      operation: 'resolve',
      path: fileURLToPath(root),
      reason: `Drizzle snapshots reference missing parents: ${missing.join(', ')}.`,
    });
  }

  const parents = new Set(sources.flatMap((source) => source.snapshot.prevIds));
  const heads = sources.filter((source) => !parents.has(source.snapshot.id));

  if (heads.length !== 1) {
    return yield* new Failure({
      operation: 'resolve',
      path: fileURLToPath(root),
      reason: `Expected one Drizzle snapshot head. Found ${heads.length}: ${heads.map((source) => source.folder).join(', ')}.`,
    });
  }

  const head = heads[0];

  if (!head) {
    return yield* new Failure({
      operation: 'resolve',
      path: fileURLToPath(root),
      reason: 'Drizzle snapshot head is missing.',
    });
  }

  const seen = new Set<string>();
  const cycle = visit(head.snapshot.id, ids, seen, new Set());

  if (cycle) {
    return yield* new Failure({
      operation: 'resolve',
      path: fileURLToPath(root),
      reason: `Drizzle snapshot graph contains a cycle at ${cycle}.`,
    });
  }

  if (seen.size !== sources.length) {
    const detached = sources.filter((source) => !seen.has(source.snapshot.id));

    return yield* new Failure({
      operation: 'resolve',
      path: fileURLToPath(root),
      reason: `Drizzle snapshot graph is disconnected: ${detached.map((source) => source.folder).join(', ')}.`,
    });
  }

  return head;
});

const contract = Effect.fn('ReplicaCodegen.contract')(function* (
  source: Source,
  replica: (typeof model.all)[number],
) {
  const raw = source.snapshot.ddl.filter(
    (entry) =>
      entry.entityType === 'columns' &&
      entry.table === replica.table &&
      replica.columns.includes(entry.name),
  );
  const columns = yield* Effect.forEach(raw, (entry) =>
    Schema.decodeUnknownEffect(Column)(entry).pipe(
      Effect.mapError((cause) => failure('decode-column', source.path, cause)),
    ),
  );
  const sorted = columns.toSorted((left, right) => left.name.localeCompare(right.name));
  const expected = replica.columns.toSorted();
  const found = sorted.map((column) => column.name);

  if (expected.length !== found.length || expected.some((name, index) => name !== found[index])) {
    return yield* new Failure({
      operation: 'contract',
      path: replica.table,
      reason: `Snapshot columns differ for ${replica.name}. Expected ${expected.join(', ')}. Found ${found.join(', ')}.`,
    });
  }

  const schemas = new Set(sorted.map((column) => column.schema));

  if (schemas.size !== 1) {
    return yield* new Failure({
      operation: 'contract',
      path: replica.table,
      reason: `Replica columns must use one PostgreSQL schema. Found ${[...schemas].join(', ')}.`,
    });
  }

  const value = {
    columns: sorted.map((column) => ({
      dimensions: column.dimensions,
      name: column.name,
      notNull: column.notNull,
      type: column.type,
      typeSchema: column.typeSchema,
    })),
    key: 'id',
    mapper: 'electric-snake-camel-v1',
    name: replica.name,
    persistence: 'tanstack-sqlite-json-v1',
    rowSchema: z.toJSONSchema(replica.schema, { unrepresentable: 'any' }),
    schema: sorted[0]?.schema ?? 'public',
    table: replica.table,
    transformer: 'drizzle-zod-date-v1',
    where: replica.where,
  } as const;
  const hash = digest(canonical({ algorithm, contract: value }));

  return {
    name: replica.name,
    value: {
      algorithm,
      cacheVersion: Number.parseInt(hash.slice(0, 13), 16),
      contract: value,
      digest: `sha256:${hash}`,
      sourceDigest: tagged(canonical(sorted)),
    },
  } as const;
});

const compile = Effect.fn('ReplicaCodegen.compile')(function* (sources: ReadonlyArray<Source>) {
  const head = yield* resolve(sources);
  const replicas = yield* Effect.forEach(model.all, (replica) => contract(head, replica));
  const history = sources
    .toSorted((left, right) => left.folder.localeCompare(right.folder))
    .map(provenance);

  return {
    format: 2,
    database: {
      dialect: head.snapshot.dialect,
      head: provenance(head),
      history,
      historyDigest: tagged(canonical(history)),
    },
    replicas: Object.fromEntries(replicas.map((entry) => [entry.name, entry.value])),
  } as const;
});

const compare = Effect.fn('ReplicaCodegen.check')(function* (code: string) {
  const current = yield* optional(target);

  if (current !== code) {
    return yield* new Failure({
      operation: 'check',
      path: fileURLToPath(target),
      reason: 'Replica manifest is stale. Run `bun run db:generate`.',
    });
  }
});

const write = Effect.fn('ReplicaCodegen.write')(function* (code: string) {
  const current = yield* optional(target);

  if (current === code) return false;

  yield* Effect.tryPromise({
    try: () => Bun.write(target, code),
    catch: (cause) => failure('write', target, cause),
  });
  return true;
});

const build = Effect.fn('ReplicaCodegen.build')(function* () {
  const sources = yield* discover();
  const manifest = yield* compile(sources);
  return render(manifest);
});

const schema = Effect.fn('ReplicaCodegen.schema')(function* () {
  const path = fileURLToPath(config);
  const generated = yield* Effect.tryPromise({
    try: () => generate({ config: path }),
    catch: (cause) => failure('drizzle-generate', config, cause),
  });

  if (generated.status === 'error') {
    return yield* new Failure({
      operation: 'drizzle-generate',
      path,
      reason: JSON.stringify(generated.error),
    });
  }

  if (generated.status === 'missing_hints') {
    return yield* new Failure({
      operation: 'drizzle-generate',
      path,
      reason: `Drizzle requires migration hints: ${JSON.stringify(generated.unresolved)}.`,
    });
  }

  const checked = yield* Effect.tryPromise({
    try: () => check({ config: path }),
    catch: (cause) => failure('drizzle-check', config, cause),
  });

  if (checked.status === 'error') {
    return yield* new Failure({
      operation: 'drizzle-check',
      path,
      reason: JSON.stringify(checked.error),
    });
  }

  if (generated.status === 'ok' && 'migration_path' in generated) {
    yield* Effect.sync(() => console.log(`Generated ${generated.migration_path}.`));
  }
});

export const run = Effect.fn('ReplicaCodegen.run')(function* (mode: Mode) {
  if (mode === 'generate') {
    yield* schema();
  }

  const code = yield* build();

  if (mode === 'check') {
    return yield* compare(code);
  }

  if (yield* write(code)) {
    yield* Effect.sync(() => console.log(`Generated ${fileURLToPath(target)}.`));
  }
});

function visit(
  id: string,
  sources: ReadonlyMap<string, Source>,
  seen: Set<string>,
  active: Set<string>,
): string | undefined {
  if (id === rootId || seen.has(id)) return;
  if (active.has(id)) return id;

  const source = sources.get(id);
  if (!source) return;

  active.add(id);
  const cycle = source.snapshot.prevIds
    .map((parent) => visit(parent, sources, seen, active))
    .find((item) => item !== undefined);
  active.delete(id);
  seen.add(id);

  return cycle;
}

function timestamp(folder: string) {
  const value = folder.slice(0, 14);

  if (!/^\d{14}$/.test(value)) {
    throw new Error(`Migration folder must start with a 14-digit timestamp: ${folder}.`);
  }

  return formatToMillis(value);
}

function provenance(source: Source) {
  return {
    migration: source.folder,
    prevIds: source.snapshot.prevIds,
    snapshotDigest: tagged(source.json),
    snapshotId: source.snapshot.id,
    sqlDigest: tagged(source.sql),
    timestamp: source.timestamp,
  } as const;
}

function contents(path: URL) {
  return Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: (cause) => failure('read', path, cause),
  });
}

function optional(path: URL) {
  return Effect.tryPromise({
    try: async () => {
      const file = Bun.file(path);
      return (await file.exists()) ? await file.text() : null;
    },
    catch: (cause) => failure('read', path, cause),
  });
}

function render(manifest: Effect.Success<ReturnType<typeof compile>>) {
  const cache = Object.fromEntries(
    Object.entries(manifest.replicas).map(([name, replica]) => [name, replica.cacheVersion]),
  );

  return `// Generated by scripts/replica.ts. Run \`bun run db:generate\` after Drizzle or replica changes.
export const cache = ${JSON.stringify(cache, null, 2)} as const;

export const manifest = ${JSON.stringify(manifest, null, 2)} as const;
`;
}

function canonical(value: unknown) {
  return JSON.stringify(sort(value)) ?? 'null';
}

function tagged(value: string) {
  return `sha256:${digest(value)}`;
}

function digest(value: string) {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort(item)]),
  );
}

function failure(operation: string, path: URL | string, cause: unknown) {
  return new Failure({
    operation,
    path: typeof path === 'string' ? path : fileURLToPath(path),
    reason: cause instanceof Error ? cause.message : String(cause),
  });
}

function mode(args: readonly string[]): Mode | null {
  const flags = args.slice(2);
  if (!flags.length) return 'write';
  if (flags.length === 1 && flags[0] === '--check') return 'check';
  if (flags.length === 1 && flags[0] === '--generate') return 'generate';
  return null;
}

if (import.meta.main) {
  const selected = mode(Bun.argv);
  const program = selected
    ? run(selected)
    : new Failure({
        operation: 'parse',
        path: fileURLToPath(import.meta.url),
        reason: 'Usage: bun scripts/replica.ts [--check | --generate]',
      });

  await Effect.runPromise(
    program.pipe(
      Effect.catchTag('ReplicaCodegenFailure', (error) =>
        Effect.sync(() => {
          console.error(`${error.operation} failed for ${error.path}: ${error.reason}`);
          process.exitCode = 1;
        }),
      ),
    ),
  );
}
