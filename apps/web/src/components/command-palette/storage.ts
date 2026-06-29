import { useSyncExternalStore } from 'react';

import type { CommandScreen } from '~/components/command-palette/types';

const RECENTS = 'canary.commandPalette.recents.v2';
const LEGACY_RECENTS = 'canary.commandPalette.recents.v1';
const SCREEN = 'canary.commandPalette.screen.v2';
const LEGACY_SCREEN = 'canary.commandPalette.screen.v1';
const MAX_RECENTS = 20;
const SCREENS = ['account', 'create-thread', 'root', 'theme', 'threads'] as const;

const empty: readonly string[] = [];
const subs = new Set<() => void>();

let raw: string | null | undefined;
let snap = empty;

function useCommandRecents() {
  return useSyncExternalStore(subscribe, recents, serverRecents);
}

function useCommandScreen() {
  return useSyncExternalStore(subscribe, readScreen, serverScreen);
}

function writeRecents(value: readonly string[]) {
  save(RECENTS, JSON.stringify(value.slice(0, MAX_RECENTS)));
}

function writeScreen(value: CommandScreen) {
  save(SCREEN, value);
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

function readScreen(): CommandScreen {
  const value = load(SCREEN) ?? legacyScreen(load(LEGACY_SCREEN));

  return isScreen(value) ? value : 'root';
}

function serverRecents() {
  return empty;
}

function serverScreen(): CommandScreen {
  return 'root';
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

function legacyScreen(value: string | null) {
  return value === 'create' ? 'create-thread' : value;
}

function isScreen(value: string | null): value is CommandScreen {
  return SCREENS.some((item) => item === value);
}

export { useCommandRecents, useCommandScreen, writeRecents, writeScreen };
