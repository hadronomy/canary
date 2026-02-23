import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import { Duration, Effect, Schema } from "effect";

import { and, eq, sql } from "@canary/db/drizzle";
import { DatabaseService } from "@canary/db/effect";
import { documentVersions, senseFragments } from "@canary/db/schema/legislation";
import { BoeIndexingQueue } from "~/collectors/boe/indexing/queue";
import { IndexingTriggerPayload } from "~/collectors/boe/indexing/schema";
import { BoeIndexingWorkflow } from "~/collectors/boe/indexing/workflow";

const canonicalId = "BOE-A-1989-22056";
const sourceId = "22222222-2222-4222-8222-222222222222";
const docIdSeed = "44444444-4444-4444-8444-444444444444";
const useQueue = Bun.env.BOE_INDEXING_SMOKE_USE_QUEUE === "true";

const program = Effect.gen(function* () {
  const db = yield* DatabaseService.client();

  yield* db.execute(sql`
    insert into legislative_sources (source_id, source_code, source_name, jurisdiction, provides_stage, is_official_gazette)
    values (${sourceId}, 'boe-smoke', 'BOE Smoke Source', 'estatal', array['enacted']::legislative_stage[], true)
    on conflict (source_code)
    do update set source_name = excluded.source_name, updated_at = now(), source_id = excluded.source_id
  `);

  yield* db.execute(sql`alter table legal_documents disable trigger all`);

  const docs = yield* db.execute(sql`
    insert into legal_documents (source_id, doc_id, canonical_id, short_slug, content_type, legislative_stage, official_title, content_hash)
    values (
      ${sourceId},
      ${docIdSeed},
      ${canonicalId},
      'boesmoke198922056',
      'law',
      'enacted',
      'Constitucion Espanola (smoke)',
      null
    )
    on conflict (canonical_id)
    do update set
      source_id = excluded.source_id,
      short_slug = excluded.short_slug,
      content_type = excluded.content_type,
      legislative_stage = excluded.legislative_stage,
      official_title = excluded.official_title,
      last_updated_at = now()
    returning doc_id
  `);

  yield* db.execute(sql`alter table legal_documents enable trigger all`);

  const docId = (docs as ReadonlyArray<{ doc_id: string }>)[0]?.doc_id ?? docIdSeed;
  if (!docId) {
    return yield* Effect.fail(new Error("Unable to resolve smoke document id"));
  }

  const fixture = yield* Effect.tryPromise({
    try: () => Bun.file("./test/fixtures/boe/legislative-full.xml").text(),
    catch: (cause) => new Error(`Unable to read fixture XML: ${String(cause)}`),
  });

  yield* db.delete(senseFragments).where(eq(senseFragments.docId, docId));
  yield* db.delete(documentVersions).where(eq(documentVersions.docId, docId));

  const versions = yield* db.execute(sql`
    insert into document_versions (doc_id, version_number, version_type, content_text, valid_from, valid_until)
    values (${docId}, 1, 'original', ${fixture}, now(), null)
    returning version_id
  `);

  const versionId = (versions as ReadonlyArray<{ version_id: string }>)[0]?.version_id;
  if (!versionId) {
    return yield* Effect.fail(new Error("Unable to resolve smoke version id"));
  }

  const payload = Schema.decodeUnknownSync(IndexingTriggerPayload)({
    runId: "11111111-1111-4111-8111-111111111111",
    docId,
    versionId,
    canonicalId,
    contentHash: null,
    kind: "New",
    requestedAt: new Date().toISOString(),
  });

  if (useQueue) {
    yield* BoeIndexingQueue.enqueue(payload);
  } else {
    yield* BoeIndexingWorkflow.start(payload);
  }

  const status = yield* Effect.gen(function* () {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const rows = (yield* db.execute(sql`
        select status, last_error
        from fragment_index_jobs
        where doc_id = ${docId} and version_id = ${versionId}
        limit 1
      `)) as ReadonlyArray<{ status: string; last_error: string | null }>;

      const current = rows[0];
      if (current && current.status !== "in_progress") {
        return current;
      }

      yield* Effect.sleep(Duration.seconds(1));
    }

    return { status: "timeout", last_error: "Timed out waiting for indexing completion" };
  });

  const rows = yield* db
    .select({
      fragmentId: senseFragments.fragmentId,
      embedding1024: senseFragments.embedding1024,
      embedding256: senseFragments.embedding256,
    })
    .from(senseFragments)
    .where(and(eq(senseFragments.docId, docId), eq(senseFragments.versionId, versionId)));

  const total = rows.length;
  const with1024 = rows.filter((row) => row.embedding1024 !== null).length;
  const with256 = rows.filter((row) => row.embedding256 !== null).length;

  return {
    docId,
    versionId,
    status: status.status,
    lastError: status.last_error,
    total,
    with1024,
    with256,
  };
}).pipe(
  Effect.provide(BoeIndexingQueue.Default),
  Effect.provide(BoeIndexingWorkflow.Default),
  Effect.provide(DatabaseService.Default),
  Effect.provide(FetchHttpClient.layer),
);

const result = await Effect.runPromise(program);
console.log(JSON.stringify(result, null, 2));
