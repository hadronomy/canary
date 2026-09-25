import { useSyncExternalStore } from 'react';

import type { ModelId } from '@canary/api/models';

import { fallback, isModel, models } from '@canary/api/models';

/**
 * A value kept in local storage and shared by every component and tab that
 * reads it. `parse` turns whatever is stored into a value that is valid now:
 * an id that has since left the catalog must not come back out as one.
 *
 * The parsed value is cached against the raw string it came from, because
 * `useSyncExternalStore` compares snapshots by identity and a freshly parsed
 * array on every read would re-render forever.
 */
function stored<T>(key: string, parse: (raw: string | null) => T, initial: T) {
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: T } | null = null;

  function read() {
    const raw = localStorage.getItem(key);
    if (cache?.raw !== raw) cache = { raw, value: parse(raw) };
    return cache.value;
  }

  function subscribe(fn: () => void) {
    const storage = (event: StorageEvent) => {
      if (event.key === key) fn();
    };

    listeners.add(fn);
    addEventListener('storage', storage);

    return () => {
      listeners.delete(fn);
      removeEventListener('storage', storage);
    };
  }

  function write(value: T) {
    localStorage.setItem(key, JSON.stringify(value));
    listeners.forEach((fn) => fn());
  }

  return {
    read,
    write,
    use: () => useSyncExternalStore(subscribe, read, () => initial),
  };
}

function json(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * The model the next message goes to. One choice for the whole app rather
 * than one per thread: it is a preference about how to work, and it follows
 * the person from the new-thread screen into the thread and back.
 */
const model = stored<ModelId>(
  'canary-model',
  (raw) => {
    const value = json(raw);
    return typeof value === 'string' && isModel(value) ? value : fallback;
  },
  fallback,
);

/** Starred models, seeded from the catalog's picks until someone stars one. */
const seeded = models.filter((entry) => entry.favorite).map((entry) => entry.id);

const favorites = stored<readonly ModelId[]>(
  'canary-favorites',
  (raw) => {
    const value = json(raw);
    if (!Array.isArray(value)) return seeded;
    return value.filter((id): id is ModelId => typeof id === 'string' && isModel(id));
  },
  seeded,
);

function useModel() {
  return model.use();
}

function pick(id: ModelId) {
  model.write(id);
}

function useFavorites() {
  return favorites.use();
}

function star(id: ModelId) {
  const now = favorites.read();
  favorites.write(now.includes(id) ? now.filter((entry) => entry !== id) : [...now, id]);
}

export { pick, star, useFavorites, useModel };
