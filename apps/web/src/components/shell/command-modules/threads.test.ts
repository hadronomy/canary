import { describe, expect, test } from 'bun:test';

import type { ShellCommandDeps } from '~/components/shell/command-modules/types';

import { THREAD_TITLE_LIMIT } from '@canary/api/thread-title';
import { createThread, rename } from '~/components/shell/command-modules/threads';

function fixture() {
  const wait = Promise.withResolvers<void>();
  const titles: string[] = [];
  const closes: boolean[] = [];
  const visits: string[] = [];
  const col = {
    insert(row: { title: string }) {
      titles.push(row.title);
      return { isPersisted: { promise: wait.promise } };
    },
    update(_id: string, change: (row: { title: string; updatedAt: string }) => void) {
      const row = { title: 'Old title', updatedAt: '' };
      change(row);
      titles.push(row.title);
      return { isPersisted: { promise: wait.promise } };
    },
  };
  const deps = {
    col,
    nav: async (route: { params: { threadId: string } }) => {
      visits.push(route.params.threadId);
    },
    onOpenChange: (open: boolean) => closes.push(open),
    user: { id: 'owner' },
  } as unknown as ShellCommandDeps;

  return { closes, deps, titles, visits, wait };
}

describe('thread command actions', () => {
  test('rejects an overlong create title before inserting', async () => {
    const data = fixture();

    await expect(createThread(data.deps, 'a'.repeat(THREAD_TITLE_LIMIT + 1))).rejects.toThrow();
    expect(data.titles).toEqual([]);
    expect(data.closes).toEqual([]);
    expect(data.visits).toEqual([]);
  });

  test('waits for create persistence before navigation', async () => {
    const data = fixture();
    const task = createThread(data.deps, '  New title  ');

    expect(data.titles).toEqual(['New title']);
    expect(data.closes).toEqual([]);
    data.wait.resolve();
    await task;
    expect(data.closes).toEqual([false]);
    expect(data.visits).toHaveLength(1);
  });

  test('keeps create open when persistence fails', async () => {
    const data = fixture();
    const task = createThread(data.deps, 'New title');

    data.wait.reject(new Error('offline'));
    await expect(task).rejects.toThrow('offline');
    expect(data.closes).toEqual([]);
    expect(data.visits).toEqual([]);
  });

  test('rejects invalid rename titles before updating', async () => {
    const data = fixture();

    await expect(rename(data.deps, 'thread', '  ')).rejects.toThrow();
    await expect(rename(data.deps, 'thread', 'a'.repeat(THREAD_TITLE_LIMIT + 1))).rejects.toThrow();
    expect(data.titles).toEqual([]);
    expect(data.closes).toEqual([]);
  });

  test('keeps rename open when persistence fails', async () => {
    const data = fixture();
    const task = rename(data.deps, 'thread', '  New title  ');

    expect(data.titles).toEqual(['New title']);
    data.wait.reject(new Error('offline'));
    await expect(task).rejects.toThrow('offline');
    expect(data.closes).toEqual([]);
  });

  test('closes rename after persistence succeeds', async () => {
    const data = fixture();
    const task = rename(data.deps, 'thread', 'a'.repeat(THREAD_TITLE_LIMIT));

    expect(data.closes).toEqual([]);
    data.wait.resolve();
    await task;
    expect(data.closes).toEqual([false]);
  });
});
