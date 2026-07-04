import {
  createCollection,
  eq,
  localStorageCollectionOptions,
  useLiveQuery,
} from '@tanstack/react-db';
import { useEffect, useMemo } from 'react';
import { z } from 'zod';

import type { CommandRegistry, ItemId, PageId } from '~/components/command-palette/types';

import { normalize } from '~/components/command-palette/text';
import { ROOT_PAGE, itemId, pageId } from '~/components/command-palette/types';

const USAGE = 'canary.commandPalette.usage.v1';
const PREFS = 'canary.commandPalette.prefs.v1';
const MAX_QUERY = 32;
const MAX_PREFIX = 12;

const hit = z.object({
  count: z.number().int().nonnegative(),
  last: z.number().int().nonnegative(),
});

const usage = z.object({
  count: z.number().int().nonnegative(),
  id: z.string(),
  item: z.string(),
  last: z.number().int().nonnegative(),
  query: z.record(z.string(), hit),
  user: z.string(),
});

const prefs = z.object({
  id: z.string(),
  page: z.string(),
  updated: z.number().int().nonnegative(),
  user: z.string(),
});

type StoredUse = z.infer<typeof usage>;
type StoredPrefs = z.infer<typeof prefs>;
type CommandUse = Omit<StoredUse, 'item'> & { item: ItemId };
type CommandPrefs = Omit<StoredPrefs, 'page'> & { page: PageId };
type CommandUsage = ReadonlyMap<ItemId, CommandUse>;

const commandUsageCollection = createCollection(
  localStorageCollectionOptions({
    getKey: (item) => item.id,
    id: 'command-palette-usage',
    schema: usage,
    storageKey: USAGE,
  }),
);

const commandPrefsCollection = createCollection(
  localStorageCollectionOptions({
    getKey: (item) => item.id,
    id: 'command-palette-prefs',
    schema: prefs,
    storageKey: PREFS,
  }),
);

function useCommandLearning(user: string, registry: CommandRegistry) {
  const uses = useLiveQuery(
    (q) => q.from({ use: commandUsageCollection }).where(({ use }) => eq(use.user, user)),
    [user],
  );
  const pref = useLiveQuery(
    (q) => q.from({ pref: commandPrefsCollection }).where(({ pref }) => eq(pref.user, user)),
    [user],
  );
  const ready = uses.isReady && pref.isReady;
  const rows = useMemo(
    () =>
      new Map(
        uses.data.map((row) => [
          itemId(row.item),
          {
            ...row,
            item: itemId(row.item),
          },
        ]),
      ),
    [uses.data],
  );

  useEffect(() => {
    if (!ready) return;

    pruneCommandUsage(user, registry);
  }, [ready, registry, user]);

  return {
    page: pageId(pref.data[0]?.page ?? ROOT_PAGE),
    ready,
    usage: rows,
  };
}

function recordCommandUse(input: { item: ItemId; query: string; user: string }) {
  const id = usageKey(input.user, input.item);
  const row = commandUsageCollection.state.get(id);
  const now = Date.now();

  if (!row) {
    commandUsageCollection.insert({
      count: 1,
      id,
      item: input.item,
      last: now,
      query: mergeQueryHits({}, input.query, now),
      user: input.user,
    });
    return;
  }

  commandUsageCollection.update(id, (draft) => {
    draft.count += 1;
    draft.last = now;
    draft.query = mergeQueryHits(draft.query, input.query, now);
  });
}

function resetCommandUse(input: { item: ItemId; user: string }) {
  const id = usageKey(input.user, input.item);

  if (commandUsageCollection.state.has(id)) commandUsageCollection.delete(id);
}

function writeCommandPage(input: { page: PageId; user: string }) {
  const id = prefsKey(input.user);
  const row = commandPrefsCollection.state.get(id);
  const now = Date.now();

  if (!row) {
    commandPrefsCollection.insert({
      id,
      page: input.page,
      updated: now,
      user: input.user,
    });
    return;
  }

  commandPrefsCollection.update(id, (draft) => {
    draft.page = input.page;
    draft.updated = now;
  });
}

function pruneCommandUsage(user: string, registry: CommandRegistry) {
  const ids = new Set(registry.items.keys());

  Array.from(commandUsageCollection.state.values())
    .filter((item) => item.user === user && !ids.has(itemId(item.item)))
    .map((item) => item.id)
    .forEach((id) => commandUsageCollection.delete(id));
}

function mergeQueryHits(
  value: Record<string, { count: number; last: number }>,
  query: string,
  now: number,
) {
  const terms = queryPrefixes(query);
  const next = terms.reduce(
    (acc, item) => ({
      ...acc,
      [item]: {
        count: (acc[item]?.count ?? 0) + 1,
        last: now,
      },
    }),
    { ...value },
  );

  return Object.fromEntries(
    Object.entries(next)
      .toSorted((a, b) => b[1].last - a[1].last || b[1].count - a[1].count)
      .slice(0, MAX_QUERY),
  );
}

function queryPrefixes(value: string) {
  const text = normalize(value);

  if (!text) return [];

  return Array.from(
    new Set([
      ...Array.from({ length: Math.min(text.length, MAX_PREFIX) }, (_, index) =>
        text.slice(0, index + 1),
      ),
      text,
    ]),
  );
}

function usageKey(user: string, item: ItemId) {
  return `${user}:${item}`;
}

function prefsKey(user: string) {
  return `${user}:prefs`;
}

export {
  commandPrefsCollection,
  commandUsageCollection,
  mergeQueryHits,
  queryPrefixes,
  recordCommandUse,
  resetCommandUse,
  usageKey,
  useCommandLearning,
  writeCommandPage,
};
export type { CommandPrefs, CommandUse, CommandUsage };
