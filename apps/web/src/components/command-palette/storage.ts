import { useSyncExternalStore } from 'react';

import type { CommandPageId } from '~/components/command-palette/types';

const RECENTS = 'canary.commandPalette.recents.v2';
const LEGACY_RECENTS = 'canary.commandPalette.recents.v1';
const PAGE = 'canary.commandPalette.screen.v2';
const LEGACY_PAGE = 'canary.commandPalette.screen.v1';
const MAX_RECENTS = 20;
const ROOT = 'root';

const empty: readonly string[] = [];
const subs = new Set<() => void>();

let raw: string | null | undefined;
let snap = empty;

function useCommandRecents() {
  return useSyncExternalStore(subscribe, recents, serverRecents);
}

function useCommandPage() {
  return useSyncExternalStore(subscribe, readPage, serverPage);
}

function writeRecents(value: readonly string[]) {
  save(RECENTS, JSON.stringify(value.slice(0, MAX_RECENTS)));
}

function writePage(value: CommandPageId) {
  save(PAGE, value);
}

function subscribe(fn: () => void) {
  subs.add(fn);

  if (typeof window === 'undefined') {
    return () => subs.delete(fn);
  }

  window.addEventListener('storage', fn);

  return () => {
    subs.delete(fn);
    window.removeEventListener('storage', fn);
  };
}

function emit() {
  subs.forEach((fn) => fn());
}

function recents() {
  const next = load(RECENTS) ?? load(LEGACY_RECENTS);

  if (next === raw) return snap;

  raw = next;
  snap = parse(next);

  return snap;
}

function readPage(): CommandPageId {
  return legacy(load(PAGE) ?? load(LEGACY_PAGE)) ?? ROOT;
}

function serverRecents() {
  return empty;
}

function serverPage(): CommandPageId {
  return ROOT;
}

function parse(value: string | null | undefined) {
  if (!value) return empty;

  try {
    const data: unknown = JSON.parse(value);

    return Array.isArray(data)
      ? data.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENTS)
      : empty;
  } catch {
    return empty;
  }
}

function load(key: string) {
  if (typeof window === 'undefined') return null;

  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(key, value);
    emit();
  } catch {}
}

function legacy(value: string | null) {
  if (!value) return null;
  if (value === 'create') return 'create-thread';

  return value;
}

export { useCommandPage, useCommandRecents, writePage, writeRecents };
