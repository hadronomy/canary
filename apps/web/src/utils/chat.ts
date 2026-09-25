import { and, createLiveQueryCollection, eq, or } from '@tanstack/react-db';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { find } from '@canary/api/models';
import {
  events as eventCollection,
  messages as messageCollection,
  parts as partCollection,
  runs as runCollection,
  setup as setupCollections,
  threads as threadCollection,
} from '@canary/sync';
import { client } from '~/utils/orpc';

const rosters = new Map<string, ReturnType<typeof makeRoster>>();
const logs = new Map<string, ReturnType<typeof makeFeed>>();
const texts = new Map<string, ReturnType<typeof makeTranscript>>();
const works = new Map<string, ReturnType<typeof makeActive>>();
const fails = new Map<string, ReturnType<typeof makeFailed>>();
const lasts = new Map<string, ReturnType<typeof makeLatest>>();
const runsets = new Map<string, ReturnType<typeof makeStates>>();
const docs = new Map<string, ReturnType<typeof makePieces>>();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    rosters.clear();
    logs.clear();
    texts.clear();
    works.clear();
    fails.clear();
    lasts.clear();
    runsets.clear();
    docs.clear();
  });
}

const sync = createIsomorphicFn()
  .server(() => new URL('/api/sync', getRequest().url).toString())
  .client(() => new URL('/api/sync', globalThis.location.origin).toString());

export const setup = createIsomorphicFn()
  .server(() => Promise.resolve())
  .client(() => setupCollections());

export function list(ownerId: string) {
  return threadCollection({
    base: sync(),
    ownerId,
    create: client.thread.create,
    settle: client.thread.settle,
    snooze: client.thread.snooze,
  });
}

export function messages(ownerId: string) {
  return messageCollection({
    base: sync(),
    ownerId,
    // A model id from local storage is only trusted once it is in the
    // catalog; anything else goes without one and gets the server's default.
    send: (input) => client.message.send({ ...input, model: find(input.model ?? '')?.id }),
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

/**
 * Every run this owner has, newest first.
 *
 * One collection for the whole sidebar rather than one per row: the per-thread
 * queries above are right for an open conversation, but forty of them standing
 * open just to draw forty status dots is forty live queries too many.
 */
export function states(ownerId: string) {
  const key = `runs:${ownerId}:states`;
  const hit = runsets.get(key);

  if (hit) {
    return hit;
  }

  const col = makeStates(ownerId);
  runsets.set(key, col);
  return col;
}

function makeStates(ownerId: string) {
  const col = runs(ownerId);

  return createLiveQueryCollection({
    id: `runs:${ownerId}:states`,
    query: (q) => q.from({ run: col }).orderBy(({ run }) => run.updatedAt, 'desc'),
  });
}

function makeRoster(ownerId: string) {
  const col = list(ownerId);

  return createLiveQueryCollection({
    id: `threads:${ownerId}:roster`,
    query: (q) => q.from({ thread: col }).orderBy(({ thread }) => thread.updatedAt, 'desc'),
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
