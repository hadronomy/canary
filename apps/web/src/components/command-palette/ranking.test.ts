import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { describe, expect, test } from 'bun:test';

import type { CommandUsage } from '~/components/command-palette/learning';
import type { CommandItem, CommandSection } from '~/components/command-palette/types';

import { searchCommandItems, suggestCommandItems } from '~/components/command-palette/ranking';
import { actionId, itemId, sectionId } from '~/components/command-palette/types';

describe('command palette ranking', () => {
  test('keeps exact matches above learned close matches', () => {
    const exact = item('exact', 'c');
    const chrome = item('chrome', 'Chrome');
    const usage: CommandUsage = new Map([
      [
        chrome.id,
        {
          count: 40,
          id: 'user:chrome',
          item: chrome.id,
          last: Date.now(),
          query: {
            c: {
              count: 40,
              last: Date.now(),
            },
          },
          user: 'user',
        },
      ],
    ]);

    expect(searchCommandItems([chrome, exact], 'c', usage)[0]?.id).toBe(exact.id);
  });

  test('uses learned ranking for comparable fuzzy matches', () => {
    const canary = item('canary', 'Canary');
    const chrome = item('chrome', 'Chrome');
    const usage: CommandUsage = new Map([
      [
        chrome.id,
        {
          count: 40,
          id: 'user:chrome',
          item: chrome.id,
          last: Date.now(),
          query: {
            c: {
              count: 40,
              last: Date.now(),
            },
          },
          user: 'user',
        },
      ],
    ]);

    expect(searchCommandItems([canary, chrome], 'c', usage)[0]?.id).toBe(chrome.id);
  });

  test('caps suggestions at five items', () => {
    const items = Array.from({ length: 7 }, (_, index) => item(String(index), `Item ${index}`));
    const section: CommandSection = {
      id: sectionId('test'),
      items,
      title: 'Test',
    };

    expect(suggestCommandItems([section], new Map())).toHaveLength(5);
  });
});

function item(id: string, title: string): CommandItem {
  const act = {
    id: actionId(`${id}:open`),
    run: () => undefined,
    title: 'Open',
  };

  return {
    actions: [act],
    icon: MagnifyingGlassIcon,
    id: itemId(id),
    keywords: [title],
    primary: act,
    source: 'workspace',
    title,
  };
}
