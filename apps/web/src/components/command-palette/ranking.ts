import { matchSorterWithRankInfo, rankings, type KeyOption, type RankedItem } from 'match-sorter';

import type { CommandUse, CommandUsage } from '~/components/command-palette/learning';
import type {
  CommandItem,
  CommandPage,
  CommandRegistry,
  CommandSection,
} from '~/components/command-palette/types';

import { normalize } from '~/components/command-palette/text';
import { sectionId } from '~/components/command-palette/types';

const SUGGESTIONS = 5;
const DAY = 86_400_000;
const RANGE = 30;

const keys: readonly KeyOption<CommandItem>[] = [
  { key: (item) => item.title, maxRanking: rankings.CASE_SENSITIVE_EQUAL },
  { key: (item) => [...item.keywords], maxRanking: rankings.EQUAL },
  { key: (item) => item.subtitle ?? '', maxRanking: rankings.CONTAINS },
  { key: (item) => item.source, maxRanking: rankings.CONTAINS },
];

function resolveCommandSections(
  registry: CommandRegistry,
  page: CommandPage,
  query: string,
  usage: CommandUsage,
) {
  const term = normalize(query);

  if (page.id !== registry.root) {
    return page.sections.map((section) => ({
      ...section,
      items: searchCommandItems(section.items, term, usage),
    }));
  }

  if (term) {
    return [
      {
        id: sectionId('results'),
        items: searchCommandItems(flatten(page.sections), term, usage),
        title: 'Results',
      },
    ];
  }

  const items = suggestCommandItems(page.sections, usage);
  const used = new Set(items.map((item) => item.id));
  const sections = page.sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => !used.has(item.id)),
  }));

  return items.length
    ? [{ id: sectionId('suggestions'), items, title: 'Suggestions' }, ...sections]
    : sections;
}

function searchCommandItems(items: readonly CommandItem[], query: string, usage: CommandUsage) {
  if (!query) return items;

  return matchSorterWithRankInfo(items, query, {
    keys,
    threshold: rankings.MATCHES,
  })
    .map((item) => ({
      index: item.index,
      item: item.item,
      rank: item.rank,
      score: searchScore(item, query, usage.get(item.item.id)),
    }))
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.item);
}

function suggestCommandItems(sections: readonly CommandSection[], usage: CommandUsage) {
  return flatten(sections)
    .map((item, index) => ({
      index,
      item,
      score: suggestScore(item, usage.get(item.id)),
    }))
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, SUGGESTIONS)
    .map((item) => item.item);
}

function searchScore(item: RankedItem<CommandItem>, query: string, usage: CommandUse | undefined) {
  return item.rank * 1000 + queryBoost(usage, query) + globalBoost(usage);
}

function suggestScore(item: CommandItem, usage: CommandUse | undefined) {
  return (usage ? 1000 + globalBoost(usage) : 0) + contextBoost(item);
}

function queryBoost(usage: CommandUse | undefined, query: string) {
  const hit = usage?.query[query] ?? usage?.query[query.slice(0, 12)];

  if (!hit) return 0;

  return Math.min(240, Math.log2(hit.count + 1) * 80 + fresh(hit.last) * 40);
}

function globalBoost(usage: CommandUse | undefined) {
  if (!usage) return 0;

  return Math.min(120, Math.log2(usage.count + 1) * 30 + fresh(usage.last) * 15);
}

function contextBoost(item: CommandItem) {
  const subtitle = item.subtitle?.toLowerCase() ?? '';

  if (subtitle.startsWith('current')) return 80;

  return 0;
}

function fresh(value: number) {
  const days = Math.max(0, Date.now() - value) / DAY;

  return Math.max(0, 1 - days / RANGE);
}

function flatten(sections: readonly CommandSection[]) {
  return sections.flatMap((section) => section.items);
}

export { resolveCommandSections, searchCommandItems, suggestCommandItems };
