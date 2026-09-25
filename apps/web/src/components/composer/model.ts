import { useSyncExternalStore } from 'react';

import type { ModelId } from '@canary/api/models';

import { fallback, find } from '@canary/api/models';

/**
 * The model the next message goes to. One choice for the whole app rather
 * than one per thread: it is a preference about how to work, and it follows
 * the person from the new-thread screen into the thread and back.
 *
 * Kept in local storage and read through `useSyncExternalStore`, so every
 * composer on screen, and every tab, agrees on it. A stored id that has since
 * left the catalog reads as the fallback, not as a model the API will refuse.
 */
const KEY = 'canary-model';

const listeners = new Set<() => void>();

function read(): ModelId {
  return find(localStorage.getItem(KEY) ?? '')?.id ?? fallback;
}

function subscribe(fn: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY) fn();
  };

  listeners.add(fn);
  addEventListener('storage', storage);

  return () => {
    listeners.delete(fn);
    removeEventListener('storage', storage);
  };
}

function pick(id: ModelId) {
  localStorage.setItem(KEY, id);
  listeners.forEach((fn) => fn());
}

function useModel() {
  return useSyncExternalStore(subscribe, read, () => fallback);
}

export { pick, useModel };
