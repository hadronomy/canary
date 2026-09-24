import type { Thread } from '@canary/sync';
import type { list } from '~/utils/chat';

/**
 * Where a thread is filed. Open threads are the working list. A snoozed thread
 * is out of the way until it wakes; a settled one is done with and kept at the
 * foot of the list, one click from coming back.
 *
 * Snoozing is read against the clock rather than stored as a state, so a
 * thread wakes on its own the moment its time passes, with no write to make
 * it happen.
 */
type Shelf = 'open' | 'snoozed' | 'settled';

type Wake = { id: string; label: string; at: Date };

const HOUR = 3_600_000;

function shelf(thread: Thread, now: number): Shelf {
  if (thread.settledAt) return 'settled';
  if (thread.snoozedUntil && thread.snoozedUntil.getTime() > now) return 'snoozed';
  return 'open';
}

/**
 * When the thread last asked for attention. A thread that woke from a snooze
 * did so at its wake time, so it comes back at the top of the list rather than
 * wherever its last message left it.
 */
function moved(thread: Thread, now: number) {
  const wake = thread.snoozedUntil?.getTime() ?? 0;
  return Math.max(thread.updatedAt.getTime(), wake <= now ? wake : 0);
}

/**
 * The times a thread can be snoozed until, from `now`: an hour out, this
 * evening, tomorrow morning and next Monday morning. The evening is left out
 * once it is less than an hour and a half away — by then it is the same
 * choice as the first one.
 */
function wakes(now: Date): Wake[] {
  const at = (days: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date;
  };
  // Next Monday, and never tomorrow: on a Sunday that is already "Tomorrow".
  const monday = (8 - now.getDay()) % 7 || 7;
  const evening = at(0, 18);

  return [
    { id: 'hour', label: 'In an hour', at: new Date(now.getTime() + HOUR) },
    ...(evening.getTime() - now.getTime() > 1.5 * HOUR
      ? [{ id: 'evening', label: 'This evening', at: evening }]
      : []),
    { id: 'tomorrow', label: 'Tomorrow', at: at(1, 9) },
    { id: 'week', label: 'Next week', at: at(monday === 1 ? 8 : monday, 9) },
  ];
}

/**
 * A wake time as short as it can be and still be unambiguous: the time alone
 * today, the weekday within the week, a date beyond it.
 */
function until(date: Date, now: Date) {
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((midnight(date) - midnight(now)) / (24 * HOUR));

  if (days <= 0) return time.format(date);
  if (days < 7) {
    return `${new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)} ${time.format(date)}`;
  }
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

function midnight(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Settle a thread, or bring it back. Either way it leaves any snooze. */
function settle(col: ReturnType<typeof list>, id: string, on: boolean) {
  col.update(id, (draft) => {
    draft.settledAt = on ? new Date().toISOString() : null;
    draft.snoozedUntil = null;
  });
}

/** Snooze a thread until `at`, or wake it now with `null`. */
function snooze(col: ReturnType<typeof list>, id: string, at: Date | null) {
  col.update(id, (draft) => {
    draft.snoozedUntil = at ? at.toISOString() : null;
  });
}

export { moved, settle, shelf, snooze, until, wakes };
export type { Shelf, Wake };
