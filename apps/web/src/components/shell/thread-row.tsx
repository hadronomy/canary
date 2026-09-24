import type { ReactElement, ReactNode, RefObject } from 'react';

import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleHalfIcon,
  CircleIcon,
  ClockIcon,
  MoonIcon,
  SunHorizonIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import type { Shelf } from '~/utils/filing';

import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { cn } from '~/lib/utils';
import { until, wakes } from '~/utils/filing';

/** What the thread's most recent run is doing, if it has had one. */
type ThreadState = 'running' | 'failed' | 'done' | 'idle';

type ThreadRowProps = {
  active: boolean;
  id: string;
  onSettle: (id: string, on: boolean) => void;
  onSnooze: (id: string, at: Date | null) => void;
  shelf?: Shelf;
  state?: ThreadState;
  title: string;
  updated: Date;
  wake?: Date | null;
};

/**
 * One thread: what it is about on the first line, and on the second the short
 * id and how long ago it moved.
 *
 * Two lines, because the second one is what tells two similar titles apart and
 * what makes the list scannable by recency without opening anything. The state
 * of the last run sits on the title's line, where the eye already is when it
 * reads the name.
 *
 * Under the pointer the state gives way to what can be done with the thread:
 * snooze it, or settle it. The actions are laid over the row rather than in
 * it, so nothing reflows when they appear — the title fades out underneath
 * them instead of being cut off by them.
 */
function ThreadRow({
  active,
  id,
  onSettle,
  onSnooze,
  shelf = 'open',
  state = 'idle',
  title: label,
  updated,
  wake,
}: ThreadRowProps) {
  const title = label.trim() || 'Untitled thread';
  // The actions stay up while the snooze menu is open, or they would vanish
  // from under it the moment the pointer moved onto the menu.
  const [menu, setMenu] = useState(false);
  const row = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={row}
      className={cn(
        'group/item relative grid grid-cols-[minmax(0,1fr)_auto] rounded-(--radius-control) border',
        // Hover switches on at once; the row is crossed on the way down the
        // list far more often than it is opened.
        active
          ? 'border-input/50 bg-surface-3 shadow-surface-1'
          : 'border-transparent hover:bg-hover focus-within:bg-hover data-[menu=true]:bg-hover',
      )}
      data-menu={menu}
    >
      <Link
        aria-current={active ? 'page' : undefined}
        className="min-w-0 rounded-(--radius-control) py-1.5 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        params={{ threadId: id }}
        preload={false}
        to="/threads/$threadId"
      >
        <span
          className={cn(
            'block truncate text-[13.5px] leading-5',
            // The title runs under the actions, so it fades out before it
            // reaches them rather than being sliced by their edge.
            'group-hover/item:[mask-image:linear-gradient(to_right,black_calc(100%-var(--cover)-1.25rem),transparent_calc(100%-var(--cover)))]',
            'group-focus-within/item:[mask-image:linear-gradient(to_right,black_calc(100%-var(--cover)-1.25rem),transparent_calc(100%-var(--cover)))]',
            'group-data-[menu=true]/item:[mask-image:linear-gradient(to_right,black_calc(100%-var(--cover)-1.25rem),transparent_calc(100%-var(--cover)))]',
            active
              ? 'text-foreground'
              : shelf === 'open'
                ? 'text-foreground/85'
                : 'text-muted-foreground',
          )}
          // How far past the title's own column the actions reach.
          style={{ ['--cover' as string]: shelf === 'settled' ? '3rem' : '4rem' }}
        >
          {title}
        </span>

        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-muted-foreground">
          <span className="shrink-0 font-mono tabular-nums">{id.slice(0, 8)}</span>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          {shelf === 'snoozed' && wake ? (
            <span className="flex shrink-0 items-center gap-1 tabular-nums">
              <MoonIcon aria-hidden className="size-3" weight="regular" />
              <span className="sr-only">Snoozed until</span>
              <time dateTime={wake.toISOString()}>{until(wake, new Date())}</time>
            </span>
          ) : (
            <time className="shrink-0 tabular-nums" dateTime={updated.toISOString()}>
              {when(updated)}
            </time>
          )}
        </span>
      </Link>

      <div
        aria-hidden
        className="grid h-8 w-8 place-items-center group-hover/item:invisible group-focus-within/item:invisible group-data-[menu=true]/item:invisible"
      >
        <State state={state} />
      </div>

      {/* Level with the title and ending on the state column, so the last
          action lands where the eye already looks for the thread's mark. */}
      <div
        className={cn(
          'invisible absolute top-1 right-1 flex items-center gap-px',
          'group-hover/item:visible group-focus-within/item:visible group-data-[menu=true]/item:visible',
        )}
      >
        {shelf === 'snoozed' ? (
          <Tip label="Wake now">
            <Button
              aria-label={`Wake ${title}`}
              className={ICON}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={() => onSnooze(id, null)}
            >
              <SunHorizonIcon className="size-3.5" weight="regular" />
            </Button>
          </Tip>
        ) : shelf === 'open' ? (
          <Snooze
            anchor={row}
            title={title}
            onOpenChange={setMenu}
            onPick={(at) => onSnooze(id, at)}
          />
        ) : null}

        {shelf === 'settled' ? (
          <Action label={`Reopen ${title}`} onClick={() => onSettle(id, false)}>
            <ArrowCounterClockwiseIcon className="size-3.5" weight="regular" />
            Reopen
          </Action>
        ) : (
          <Action label={`Settle ${title}`} onClick={() => onSettle(id, true)}>
            <CheckIcon className="size-3.5" weight="regular" />
            Settle
          </Action>
        )}
      </div>
    </div>
  );
}

const ICON = cn(
  'size-6 text-muted-foreground hover:bg-surface-4 hover:text-foreground',
  'active:scale-[0.94] data-[popup-open]:bg-surface-4 data-[popup-open]:text-foreground',
);

function Action(props: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={props.label}
      className={cn(
        'flex h-6 items-center gap-1 rounded-(--radius-press) pr-2 pl-1.5 text-[12px] text-muted-foreground',
        'hover:bg-surface-4 hover:text-foreground',
        'transition-[scale] duration-(--t-press) ease-out-strong active:scale-[0.96] motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
      )}
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/**
 * Snooze, as a short list of times rather than a picker. Each option carries
 * the moment it lands on, so "Tomorrow" never has to be guessed at.
 */
function Snooze(props: {
  anchor: RefObject<HTMLDivElement | null>;
  title: string;
  onOpenChange: (open: boolean) => void;
  onPick: (at: Date) => void;
}) {
  const [now, setNow] = useState(() => new Date());

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // Read the clock on open, so an hour from now means from now.
        if (open) setNow(new Date());
        props.onOpenChange(open);
      }}
    >
      <Tip label="Snooze">
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Snooze ${props.title}`}
              className={ICON}
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <ClockIcon className="size-3.5" weight="regular" />
        </DropdownMenuTrigger>
      </Tip>

      {/* Hung from the row rather than the clock: it opens below the whole
          thread, on the row's right edge, and down into the sidebar instead of
          spilling over the page. */}
      <DropdownMenuContent
        align="end"
        anchor={props.anchor}
        className={cn(
          'w-52 rounded-[10px] p-1',
          'data-open:duration-150 data-closed:duration-100 ease-out-strong',
          'data-open:zoom-in-[0.97] data-closed:zoom-out-[0.97] data-[side=bottom]:slide-in-from-top-1',
        )}
        sideOffset={4}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-[11.5px] leading-4">
            Snooze until
          </DropdownMenuLabel>
          {wakes(now).map((item) => (
            <DropdownMenuItem
              className={cn(
                'h-8 justify-between gap-4 rounded-[6px] px-2 py-0 text-[13px] text-foreground/85',
                'focus:bg-hover focus:text-foreground not-data-[variant=destructive]:focus:**:text-inherit',
              )}
              key={item.id}
              onClick={() => props.onPick(item.at)}
            >
              {item.label}
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {until(item.at, now)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Tip(props: { children: ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The last run, as a filled mark. Filled rather than outlined so each state
 * reads as a colour at a glance down the column; an unstarted thread keeps a
 * faint ring, so the column has one edge and an empty slot never reads as a
 * missing icon.
 */
function State({ state }: { state: ThreadState }) {
  if (state === 'running') {
    return <CircleHalfIcon className="size-3.5 text-chart-4" weight="fill" />;
  }

  if (state === 'failed') {
    return <WarningCircleIcon className="size-3.5 text-destructive" weight="fill" />;
  }

  if (state === 'done') {
    return <CheckCircleIcon className="size-3.5 text-success" weight="fill" />;
  }

  return <CircleIcon className="size-3.5 text-muted-foreground/40" weight="regular" />;
}

/**
 * How long ago, in the fewest characters that still read at a glance: minutes,
 * then hours, then a weekday, then a date.
 */
function when(date: Date) {
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return 'now';
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  if (hours < 24 * 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

export { ThreadRow };
export type { ThreadRowProps, ThreadState };
