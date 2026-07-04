import type { Icon } from '@phosphor-icons/react';

import { MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';

import type { ThemeChoice, ThreadRecord } from '~/components/shell/command-modules/types';

function currentTheme(value: string | undefined): ThemeChoice {
  return value === 'dark' || value === 'light' ? value : 'system';
}

function sorted(rows: readonly ThreadRecord[]) {
  return rows
    .filter((row) => !row.archivedAt)
    .toSorted(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}

function stamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'unknown';

  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());
  const mins = Math.floor(diff / 60_000);

  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (same(date, now)) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function themeIcon(value: ThemeChoice): Icon {
  switch (value) {
    case 'dark':
      return MoonIcon;
    case 'light':
      return SunIcon;
    default:
      return MonitorIcon;
  }
}

function themeName(value: ThemeChoice) {
  switch (value) {
    case 'dark':
      return 'Dark theme';
    case 'light':
      return 'Light theme';
    default:
      return 'System theme';
  }
}

function after(rows: readonly ThreadRecord[], id: string) {
  const at = rows.findIndex((row) => row.id === id);

  if (at < 0) return rows[0] ?? null;

  return rows[at + 1] ?? rows[at - 1] ?? null;
}

function same(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export { after, currentTheme, sorted, stamp, themeIcon, themeName };
