import { and, createLiveQueryCollection, eq, isNull, or } from '@tanstack/react-db';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import {
  clear as clearCollections,
  events as eventCollection,
  health as collectionHealth,
  messages as messageCollection,
  parts as partCollection,
  runs as runCollection,
  setup as setupCollections,
  threads as threadCollection,
  watch as watchCollections,
} from '@canary/sync';
import { client } from '~/utils/orpc';

const rosters = new Map<string, ReturnType<typeof makeRoster>>();
const logs = new Map<string, ReturnType<typeof makeFeed>>();
const texts = new Map<string, ReturnType<typeof makeTranscript>>();
const works = new Map<string, ReturnType<typeof makeActive>>();
const fails = new Map<string, ReturnType<typeof makeFailed>>();
const lasts = new Map<string, ReturnType<typeof makeLatest>>();
const docs = new Map<string, ReturnType<typeof makePieces>>();

if (import.meta.hot) {
  import.meta.hot.dispose(clear);
}

const sync = createIsomorphicFn()
  .server(() => new URL('/api/sync', getRequest().url).toString())
  .client(() => new URL('/api/sync', globalThis.location.origin).toString());

export const setup = createIsomorphicFn()
  .server(() => Promise.resolve())
  .client(() => setupCollections());

export const watch = watchCollections;

export function health(ownerId: string) {
  return collectionHealth({ base: sync(), ownerId });
}

export function clear() {
  [
    ...rosters.values(),
    ...logs.values(),
    ...texts.values(),
    ...works.values(),
    ...fails.values(),
    ...lasts.values(),
    ...docs.values(),
  ].forEach((col) => void col.cleanup());
  rosters.clear();
  logs.clear();
  texts.clear();
  works.clear();
  fails.clear();
  lasts.clear();
  docs.clear();
  clearCollections();
}

export function list(ownerId: string) {
  return threadCollection({
    base: sync(),
    ownerId,
    archive: client.thread.archive,
    create: client.thread.create,
    rename: client.thread.rename,
  });
}

export function messages(ownerId: string) {
  return messageCollection({
    base: sync(),
    ownerId,
    send: client.message.send,
  });
}

export function runs(ownerId: string) {
  return runCollection({ base: sync(), ownerId });
}

export function events(ownerId: string) {
  return eventCollection({ base: sync(), ownerId });
}

export function parts(ownerId: string) {
  return partCollection({ base: sync(), ownerId });
}

export function roster(ownerId: string) {
  const key = `threads:${ownerId}`;
  const hit = rosters.get(key);

  if (hit) {
    return hit;
  }

  const col = makeRoster(ownerId);
  rosters.set(key, col);

  return col;
}

function makeRoster(ownerId: string) {
  const col = list(ownerId);

  return createLiveQueryCollection({
    id: `threads:${ownerId}:roster`,
    query: (q) =>
      q
        .from({ thread: col })
        .where(({ thread }) => isNull(thread.archivedAt))
        .orderBy(({ thread }) => thread.updatedAt, 'desc'),
  });
}

export function transcript(ownerId: string, id: string) {
  const key = `${ownerId}:${id}`;
  const hit = texts.get(key);

  if (hit) {
    return hit;
  }

  const col = makeTranscript(ownerId, id);
  texts.set(key, col);

  return col;
}

function makeTranscript(ownerId: string, id: string) {
  const col = messages(ownerId);

  return createLiveQueryCollection({
    id: `transcript:${ownerId}:${id}`,
    query: (q) =>
      q
        .from({ msg: col })
        .where(({ msg }) => eq(msg.threadId, id))
        .orderBy(({ msg }) => msg.createdAt, 'desc'),
  });
}

export function pieces(ownerId: string, id: string) {
  const key = `${ownerId}:${id}`;
  const hit = docs.get(key);

  if (hit) {
    return hit;
  }

  const col = makePieces(ownerId, id);
  docs.set(key, col);

  return col;
}

function makePieces(ownerId: string, id: string) {
  const col = parts(ownerId);

  return createLiveQueryCollection({
    id: `parts:${ownerId}:${id}`,
    query: (q) =>
      q
        .from({ part: col })
        .where(({ part }) => eq(part.threadId, id))
        .orderBy(({ part }) => part.seq, 'asc'),
  });
}

export function active(ownerId: string, id: string) {
  const key = `${ownerId}:${id}`;
  const hit = works.get(key);

  if (hit) {
    return hit;
  }

  const col = makeActive(ownerId, id);
  works.set(key, col);

  return col;
}

function makeActive(ownerId: string, id: string) {
  const col = runs(ownerId);

  return createLiveQueryCollection({
    id: `active-runs:${ownerId}:${id}`,
    query: (q) =>
      q
        .from({ run: col })
        .where(({ run }) =>
          and(eq(run.threadId, id), or(eq(run.status, 'queued'), eq(run.status, 'running'))),
        )
        .orderBy(({ run }) => run.updatedAt, 'desc'),
  });
}

export function failed(ownerId: string, id: string) {
  const key = `${ownerId}:${id}`;
  const hit = fails.get(key);

  if (hit) {
    return hit;
  }

  const col = makeFailed(ownerId, id);
  fails.set(key, col);

  return col;
}

function makeFailed(ownerId: string, id: string) {
  const col = runs(ownerId);

  return createLiveQueryCollection({
    id: `failed-runs:${ownerId}:${id}`,
    query: (q) =>
      q
        .from({ run: col })
        .where(({ run }) => and(eq(run.threadId, id), eq(run.status, 'failed')))
        .orderBy(({ run }) => run.updatedAt, 'desc')
        .limit(1),
  });
}

export function latest(ownerId: string, id: string) {
  const key = `${ownerId}:${id}`;
  const hit = lasts.get(key);

  if (hit) {
    return hit;
  }

  const col = makeLatest(ownerId, id);
  lasts.set(key, col);

  return col;
}

function makeLatest(ownerId: string, id: string) {
  const col = runs(ownerId);

  return createLiveQueryCollection({
    id: `latest-run:${ownerId}:${id}`,
    query: (q) =>
      q
        .from({ run: col })
        .where(({ run }) => eq(run.threadId, id))
        .orderBy(({ run }) => run.updatedAt, 'desc')
        .limit(1),
  });
}

export function feed(ownerId: string, id: string) {
  const key = `${ownerId}:${id}`;
  const hit = logs.get(key);

  if (hit) {
    return hit;
  }

  const col = makeFeed(ownerId, id);
  logs.set(key, col);

  return col;
}

function makeFeed(ownerId: string, id: string) {
  const col = events(ownerId);

  return createLiveQueryCollection({
    id: `events:${ownerId}:${id}:recent`,
    query: (q) =>
      q
        .from({ event: col })
        .where(({ event }) => eq(event.threadId, id))
        .orderBy(({ event }) => event.seq, 'desc')
        .limit(12),
  });
}
