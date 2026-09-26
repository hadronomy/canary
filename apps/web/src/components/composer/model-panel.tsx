import type { Icon } from '@phosphor-icons/react';
import type { KeyOption } from 'match-sorter';

import { Menu } from '@base-ui/react/menu';
import {
  BrainIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  EyeIcon,
  FadersHorizontalIcon,
  FileTextIcon,
  LockOpenIcon,
  MagnifyingGlassIcon,
  StarIcon,
} from '@phosphor-icons/react';
import { Command } from 'cmdk';
import { matchSorter, rankings } from 'match-sorter';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import {
  memo,
  useCallback,
  useDeferredValue,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';

import type { Lab, Model, ModelId } from '@canary/api/models';

import { fresh, labs, models, tier } from '@canary/api/models';
import { Mark } from '~/components/composer/mark';
import { star, useFavorites } from '~/components/composer/model';
import { ease } from '~/components/composer/motion';
import { Morph } from '~/lib/motion';
import { useScrollEdges } from '~/lib/scroll-fade';
import { cn } from '~/lib/utils';

/** A capability the list can be narrowed to. */
type Need = Extract<keyof Model, 'reasoning' | 'vision' | 'documents' | 'open'>;

type Shelf = 'favorites' | Lab;

const NEEDS: readonly { need: Need; label: string; icon: Icon }[] = [
  { need: 'reasoning', label: 'Reasoning', icon: BrainIcon },
  { need: 'vision', label: 'Reads images', icon: EyeIcon },
  { need: 'documents', label: 'Reads PDFs', icon: FileTextIcon },
  { need: 'open', label: 'Open weights', icon: LockOpenIcon },
];

// Labs in the order their first model appears in the catalog, which is the
// order they were picked in.
const LABS = [...new Set(models.map((model) => model.lab))];

/**
 * The picker's body: a search field over the whole catalog, a rail of labs
 * down the side with favourites at the top, and the models of whichever is
 * chosen — two lines each, what it is and what it can do. The foot of the
 * panel reads out the highlighted model's numbers, so the list itself stays
 * light and the detail follows the cursor instead of hiding behind a hover.
 *
 * Keyboard first: the search field has focus, the arrows walk the list,
 * Enter picks.
 */
function ModelPanel({ current, onPick }: { current: ModelId; onPick: (id: ModelId) => void }) {
  const favorites = useFavorites();
  const reduce = useReducedMotion();
  const rail = useId();

  const [query, setQuery] = useState('');
  // What the list is showing for: the field's text, settled. The field always
  // echoes every letter; the list follows it on the leading edge and then once
  // per burst of typing.
  const [term, settle] = useSettled(query);
  const [needs, setNeeds] = useState<readonly Need[]>([]);
  // Opens on whichever shelf holds the current model, so it is on screen and
  // highlighted without a search.
  const [shelf, setShelf] = useState<Shelf>(() =>
    favorites.includes(current)
      ? 'favorites'
      : (models.find((model) => model.id === current)?.lab ?? 'favorites'),
  );
  const [cursor, setCursor] = useState<string>(current);

  const shown = useMemo(
    () => select(term, shelf, favorites, needs),
    [favorites, needs, shelf, term],
  );

  // A new search starts the cursor on its first row, which is its best match.
  // Without this it would stay wherever cmdk put it for the text before the
  // search settled — possibly on a row that is now folding out.
  useLayoutEffect(() => {
    setCursor('');
  }, [term]);

  const lit = shown.find((model) => model.id === cursor) ?? shown[0];
  // A new shelf arrives as one piece. A search or a filter reshapes the list
  // in place instead, row by row, so the models that still match are never
  // redrawn — they only move to where they now belong.
  const scene = shelf;

  return (
    <Command
      className="grid grid-rows-[auto_minmax(0,1fr)_auto]"
      label="Choose a model"
      loop
      shouldFilter={false}
      value={lit?.id ?? ''}
      onValueChange={setCursor}
    >
      {/* The lens sits on the rail's column, so the panel's left edge reads as
          one line of marks from the search down through the shelves. */}
      <div className="flex items-center gap-2.5 pt-2 pr-3 pb-1.5 pl-5">
        <MagnifyingGlassIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          weight="regular"
        />
        <Command.Input
          autoFocus
          className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Search models"
          value={query}
          onKeyDown={(event) => {
            // Anything that acts on the list acts on what is typed, never on
            // the list as it was a few letters ago. Enter with a search still
            // pending picks the first match for the text itself — the list
            // has not caught up, and its cursor may sit on a row on its way
            // out. The arrows land the pending search and then move.
            if (query === term) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              const first = select(query, shelf, favorites, needs)[0];
              if (first) onPick(first.id);
              return;
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) settle(query);
          }}
          onValueChange={setQuery}
        />
        <Needs needs={needs} onNeeds={setNeeds} />
      </div>

      {/* The body's height is set here, not by its content: the rail has more
          shelves than fit, and it scrolls inside this height instead of
          stretching the panel past the room it has. */}
      <div className="grid h-[min(21rem,calc(var(--available-height)-6.5rem))] min-h-0 grid-cols-[auto_minmax(0,1fr)] gap-1 px-1.5">
        <Rail>
          <Shelf
            active={!query.trim() && shelf === 'favorites'}
            group={rail}
            label="Favorites"
            onClick={() => {
              setQuery('');
              settle('');
              setShelf('favorites');
            }}
          >
            <StarIcon className="size-4" weight={shelf === 'favorites' ? 'fill' : 'regular'} />
          </Shelf>
          {LABS.map((lab) => (
            <Shelf
              key={lab}
              active={!query.trim() && shelf === lab}
              group={rail}
              label={labs[lab].name}
              onClick={() => {
                setQuery('');
                settle('');
                setShelf(lab);
              }}
            >
              <Mark className="size-4" lab={lab} />
            </Shelf>
          ))}
        </Rail>

        <Command.List className="h-full overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin] [mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]">
          {/* Keyed rather than cross-faded: an outgoing copy of the list would
              still hold items with the same values, and cmdk would put its
              cursor on the copy that is about to unmount. */}
          <motion.div
            key={scene}
            animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
            className="grid pb-6"
            initial={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(4px)', y: 4 }}
            transition={{ duration: 0.26, ease }}
          >
            {/* cmdk counts rows still folding out, so this waits for the last
                one to leave before it says the list is empty. */}
            <Command.Empty>
              <Empty>
                {term.trim() ? (
                  `No model matches “${term.trim()}”.`
                ) : needs.length ? (
                  <>
                    Nothing here has everything the filter asks for.
                    <button
                      className="mx-auto mt-2 flex h-7 items-center rounded-full px-3 text-foreground/85 outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                      type="button"
                      onClick={() => setNeeds([])}
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  'Star a model to keep it here.'
                )}
              </Empty>
            </Command.Empty>

            <AnimatePresence initial={false}>
              {shown.map((model) => (
                <Entry
                  key={model.id}
                  current={model.id === current}
                  favorite={favorites.includes(model.id)}
                  model={model}
                  onPick={onPick}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </Command.List>
      </div>

      <Details model={lit} />
    </Command>
  );
}

/** A message where the list would be, arriving out of a short blur. */
function Empty({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();

  return (
    <motion.p
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      className="px-3 py-8 text-center text-[13px] text-muted-foreground"
      initial={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(3px)' }}
      transition={{ duration: 0.24, ease }}
    >
      {children}
    </motion.p>
  );
}

/**
 * The models to list, for a search or a shelf, narrowed by the capability
 * filter.
 *
 * Every list keeps catalog order, and a search or a filter only decides which
 * rows are in it. Typing more then only removes rows and deleting only
 * restores them, so rows fold out and in around each other and never have to
 * cross to reach a new rank.
 *
 * A search sorts in two tiers, each still in catalog order: models whose name
 * or lab matches, then models that only match by what they are for. The first
 * row is then the best match, which is where the cursor starts and so what
 * Enter picks — "deep" leads with DeepSeek, not with a model described as
 * doing deep reasoning.
 */
function select(
  search: string,
  shelf: Shelf,
  favorites: readonly ModelId[],
  needs: readonly Need[],
): Model[] {
  const text = search.trim();
  const fits = (model: Model) => needs.every((need) => model[need]);

  if (!text) {
    const keep = new Set<string>(
      shelf === 'favorites'
        ? favorites
        : models.filter((model) => model.lab === shelf).map((model) => model.id),
    );
    return models.filter((model) => keep.has(model.id) && fits(model));
  }

  // Substrings, not letters in order: "deep" should find DeepSeek and "deep
  // reasoning", not every name with a d, an e and a p in it.
  const find = (keys: KeyOption<Model>[]) =>
    new Set<string>(
      matchSorter(models, text, { keys, threshold: rankings.CONTAINS }).map((model) => model.id),
    );
  const named = find(['name', (model) => labs[model.lab].name]);
  const any = find(['name', (model) => labs[model.lab].name, 'family', 'blurb']);

  return [
    ...models.filter((model) => named.has(model.id)),
    ...models.filter((model) => any.has(model.id) && !named.has(model.id)),
  ].filter(fits);
}

// How long a pause in typing must be before the list follows, and the most a
// long burst of typing will wait. Short enough to read as immediate, long
// enough that a word typed at speed lands as one change rather than one per
// letter — one fold of the list instead of several stacked on each other.
const PAUSE = 120;
const BURST = 300;

/**
 * `value`, settled. A change after a pause comes through at once — the
 * leading edge, so the first letter answers immediately. Changes that follow
 * within `PAUSE` are held and land together when typing stops, or every
 * `BURST` while it does not, so a steady stream still shows progress.
 *
 * Settled in a layout effect: the leading edge reaches the screen in the same
 * frame as the keystroke rather than the one after. `settle` lands a value at
 * once, pending or not.
 */
function useSettled(value: string) {
  const [settled, setSettled] = useState(value);
  const latest = useRef(value);
  const last = useRef(Number.NEGATIVE_INFINITY);
  const start = useRef(0);
  const timer = useRef(0);
  latest.current = value;

  useLayoutEffect(() => {
    if (value === settled) return;

    const now = performance.now();
    const idle = now - last.current > PAUSE;
    last.current = now;

    if (idle) {
      start.current = now;
      setSettled(value);
      return;
    }

    const wait = Math.max(0, Math.min(PAUSE, start.current + BURST - now));
    timer.current = window.setTimeout(() => {
      start.current = performance.now();
      setSettled(latest.current);
    }, wait);
    return () => window.clearTimeout(timer.current);
  }, [settled, value]);

  const settle = useCallback((next: string) => {
    window.clearTimeout(timer.current);
    flushSync(() => setSettled(next));
  }, []);

  return [settled, settle] as const;
}

/**
 * The column of shelves. There are more labs than fit, so the rail scrolls,
 * and it says so quietly: the marks fade out toward whichever edge has more
 * behind it, with a small caret in the fade. Neither is drawn at an edge that
 * has nothing past it, so a rail scrolled to its end looks finished.
 *
 * The fade is a mask on the marks rather than a gradient painted over them,
 * so it matches the rail's tinted fill exactly; the fill itself sits on the
 * shell outside the mask and keeps its corners.
 */
function Rail({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(box);

  // The pressed shelf starts in view, however far down its lab sits.
  useLayoutEffect(() => {
    box.current
      ?.querySelector<HTMLElement>('[aria-pressed=true]')
      ?.scrollIntoView({ block: 'nearest' });
  }, []);

  return (
    <div className="relative min-h-0 rounded-[12px] bg-foreground/[0.035]">
      <div
        ref={box}
        aria-label="Model shelves"
        className="canary-edge-fade flex h-full min-h-0 flex-col items-center gap-1 overflow-y-auto overscroll-contain p-1 [scrollbar-width:none]"
        data-bottom={edges.bottom || undefined}
        data-top={edges.top || undefined}
        role="toolbar"
      >
        {children}
      </div>
      <Caret edge="top" on={edges.top} />
      <Caret edge="bottom" on={edges.bottom} />
    </div>
  );
}

function Caret({ edge, on }: { edge: 'top' | 'bottom'; on: boolean }) {
  const Glyph = edge === 'top' ? CaretUpIcon : CaretDownIcon;

  return (
    <Glyph
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-1/2 size-2.5 -translate-x-1/2 text-muted-foreground',
        edge === 'top' ? 'top-1' : 'bottom-1',
        // In a little faster than it goes, as the app's other scroll cues do.
        'transition-opacity duration-160 ease-out motion-reduce:transition-none',
        on ? 'opacity-70' : 'opacity-0 duration-120',
      )}
      weight="bold"
    />
  );
}

/**
 * One shelf in the rail. The active one sits on a surface that slides between
 * shelves rather than blinking from one to the next, so the eye is carried to
 * where the list now comes from.
 */
function Shelf(props: {
  active: boolean;
  children: React.ReactNode;
  group: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={props.label}
      aria-pressed={props.active}
      className={cn(
        'relative grid size-9 shrink-0 place-items-center rounded-[9px] outline-none',
        'text-muted-foreground hover:text-foreground aria-pressed:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/30',
      )}
      title={props.label}
      type="button"
      onClick={props.onClick}
    >
      {props.active ? (
        <motion.span
          className="absolute inset-0 rounded-[9px] bg-surface-4 shadow-surface-1"
          layoutId={props.group}
          transition={{ duration: 0.28, ease }}
        />
      ) : null}
      <span className="relative">{props.children}</span>
    </button>
  );
}

/**
 * One row's place in the list, memoised: a keystroke re-renders only the rows
 * whose props changed, not every row in the catalog.
 */
const Entry = memo(function Entry(props: {
  current: boolean;
  favorite: boolean;
  model: Model;
  onPick: (id: ModelId) => void;
}) {
  return (
    <Fold>
      <Row
        current={props.current}
        favorite={props.favorite}
        model={props.model}
        onPick={props.onPick}
      />
    </Fold>
  );
});

/**
 * How a row joins and leaves the list, the same for a search and a filter.
 *
 * A row leaving takes its height with it and fades, so the rows under it close
 * up over the gap instead of jumping into it; a row arriving unfolds the same
 * way. Rows are only ever added or removed around each other, never reordered,
 * so no row has to pass another to get where it is going. Motion picks each
 * fold up from wherever the last one left it, so typing faster than they finish
 * carries the list along instead of restarting it.
 *
 * The spacing between rows is inside the fold, on the row's wrapper, so it
 * collapses with the height instead of lingering as a gap once the row is
 * gone. The clip is on only while the height moves.
 */
function Fold({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const shut = { height: 0, opacity: 0, overflow: 'hidden' };

  return (
    <motion.div
      animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.12 } }
          : { ...shut, transition: { duration: 0.22, ease } }
      }
      initial={reduce ? { opacity: 0 } : shut}
      transition={{ duration: 0.28, ease }}
    >
      <div className="pb-0.5">{children}</div>
    </motion.div>
  );
}

/**
 * A model, in two lines: name, price and whether it is new or starred on the
 * first, what it is for on the second, and what it can take in on the right.
 * The current model keeps a filled surface; the cursor gets its own, lighter
 * one, instantly, as it moves.
 */
function Row(props: {
  current: boolean;
  favorite: boolean;
  model: Model;
  onPick: (id: ModelId) => void;
}) {
  const model = props.model;
  // A row on its way out is still mounted for its exit, and still an item as
  // far as cmdk knows. Disabled, the cursor and the arrow keys pass over it.
  const present = useIsPresent();

  return (
    <Command.Item
      disabled={!present}
      className={cn(
        'group/row grid cursor-default grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-[10px] px-3 py-2 outline-none select-none',
        'data-[selected=true]:bg-hover',
        props.current && 'bg-foreground/[0.06] data-[selected=true]:bg-foreground/[0.08]',
      )}
      data-current={props.current || undefined}
      keywords={[labs[model.lab].name]}
      value={model.id}
      onSelect={() => props.onPick(model.id)}
    >
      <Current on={props.current}>
        <Mark
          className="size-4 text-muted-foreground group-data-[selected=true]/row:text-foreground group-data-current/row:text-foreground"
          lab={model.lab}
        />
      </Current>

      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'truncate text-[13.5px] font-medium',
            props.current ? 'text-foreground' : 'text-foreground/85',
          )}
        >
          {model.name}
        </span>
        <Price model={model} />
        {fresh(model, Date.now()) ? (
          <span className="text-[11.5px] font-medium text-chart-4">New</span>
        ) : null}
        <Favorite model={model} on={props.favorite} />
      </span>

      <Caps model={model} />

      <span className="col-start-2 col-end-4 truncate text-[12.5px] text-muted-foreground">
        {model.blurb}
      </span>
    </Command.Item>
  );
}

/**
 * Price as three dollar signs, the ones that apply lit. Lit green while it is
 * cheap and warming toward red as it climbs, so the column reads as a scale
 * without reading any numbers — the numbers are in the footer.
 */
function Price({ model }: { model: Model }) {
  const level = tier(model);
  const tone = ['text-success', 'text-success/80', 'text-chart-4', 'text-destructive/85'][
    level - 1
  ];

  return (
    <span
      aria-label={`Price tier ${level} of 4`}
      className="flex shrink-0 text-[12px] font-medium tabular-nums"
    >
      {[1, 2, 3].map((step) => (
        <span key={step} aria-hidden className={step <= level ? tone : 'text-muted-foreground/30'}>
          $
        </span>
      ))}
      {level === 4 ? (
        <span aria-hidden className={tone}>
          +
        </span>
      ) : null}
    </span>
  );
}

/**
 * The star. Always shown once starred; otherwise only under the cursor, so a
 * list of empty outlines never competes with the names. It springs when it
 * changes, which is the only thing in the row that moves on its own.
 */
function Favorite({ model, on }: { model: Model; on: boolean }) {
  // Springs only once it has been toggled here. Keyed on `on`, it would also
  // spring on every mount, and every starred row would pop as the panel opened.
  const [toggled, setToggled] = useState(false);

  return (
    <button
      aria-label={on ? `Unstar ${model.name}` : `Star ${model.name}`}
      aria-pressed={on}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full outline-none',
        on
          ? 'text-chart-4'
          : 'invisible text-muted-foreground hover:text-foreground group-data-[selected=true]/row:visible',
        'focus-visible:visible focus-visible:ring-2 focus-visible:ring-ring/30',
      )}
      tabIndex={-1}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setToggled(true);
        star(model.id);
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span
        key={String(on)}
        className={cn(
          'grid motion-reduce:animate-none',
          toggled &&
            (on
              ? 'animate-[star-on_380ms_cubic-bezier(0.22,1,0.36,1)]'
              : 'animate-[star-off_220ms_cubic-bezier(0.22,1,0.36,1)]'),
        )}
      >
        <StarIcon className="size-3.5" weight={on ? 'fill' : 'regular'} />
      </span>
    </button>
  );
}

/**
 * The current model's mark, badged. The check sits on the mark's corner the
 * way a status sits on an avatar, so the row keeps its columns: nothing is
 * inserted beside the name or among the capabilities to say which one is
 * picked. The mark is notched under the badge rather than ringed, so the cut
 * reads on whatever fill the row has, cursor or not.
 *
 * The badge springs in when its row becomes the pick, which is the last
 * thing seen before the panel closes, and on the current model as the panel
 * opens, so the eye finds the pick first.
 */
function Current({ children, on }: { children: React.ReactNode; on: boolean }) {
  return (
    <span
      className={cn(
        'relative row-span-2 mt-0.5 grid self-start',
        on &&
          '[&>svg]:[mask-image:radial-gradient(circle_at_14px_14px,transparent_5.5px,black_6px)]',
      )}
    >
      {children}
      {on ? (
        // A CSS keyframe, not a motion component: rows sit inside an
        // AnimatePresence that skips entrances for what is there on first
        // render, and a motion element mounting inside one of them later
        // inherits that and would appear without its spring.
        <span className="absolute -right-[2.5px] -bottom-[2.5px] grid size-[9px] animate-[badge-in_340ms_cubic-bezier(0.22,1,0.36,1)] place-items-center rounded-full bg-foreground text-background motion-reduce:animate-none">
          <CheckIcon aria-hidden className="size-[7px]" weight="bold" />
          <span className="sr-only">Current model</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * What the model takes in besides text, as bare marks that light with the
 * row. Each capability has its own slot, empty when the model lacks it, so a
 * given mark sits in the same column on every row and the list can be read
 * down a column as well as along a row.
 */
function Caps({ model }: { model: Model }) {
  const caps = NEEDS.filter((entry) => entry.need !== 'open');

  return (
    <span
      aria-label={caps
        .filter((entry) => model[entry.need])
        .map((entry) => entry.label)
        .join(', ')}
      className="grid grid-cols-3 gap-1.5 justify-self-end"
    >
      {caps.map((entry) =>
        model[entry.need] ? (
          <entry.icon
            key={entry.need}
            aria-hidden
            className="size-3.5 text-muted-foreground/60 group-data-[selected=true]/row:text-muted-foreground"
            weight="regular"
          />
        ) : (
          <span key={entry.need} aria-hidden className="size-3.5" />
        ),
      )}
    </span>
  );
}

/**
 * The capability filter. Each ticked capability narrows the list further, and
 * the button says how many are on, so a short list never looks like a short
 * catalog.
 */
function Needs({
  needs,
  onNeeds,
}: {
  needs: readonly Need[];
  onNeeds: (needs: readonly Need[]) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Filter models"
        className={cn(
          'flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground outline-none',
          'hover:bg-hover hover:text-foreground data-popup-open:bg-hover data-popup-open:text-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring/30',
          needs.length > 0 && 'text-foreground',
        )}
      >
        <FadersHorizontalIcon className="size-4" weight="regular" />
        {needs.length ? <Morph className="tabular-nums">{String(needs.length)}</Morph> : null}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" className="z-50 outline-none" sideOffset={6}>
          <Menu.Popup
            className={cn(
              'w-48 origin-(--transform-origin) rounded-[12px] bg-popover p-1 text-popover-foreground shadow-surface-5 ring-1 ring-foreground/10 outline-none',
              'transition-[opacity,scale] duration-150 ease-out-strong data-ending-style:duration-100',
              'data-starting-style:scale-[0.96] data-starting-style:opacity-0 data-ending-style:scale-[0.96] data-ending-style:opacity-0',
            )}
          >
            {NEEDS.map((entry) => (
              <Menu.CheckboxItem
                key={entry.need}
                checked={needs.includes(entry.need)}
                className="flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2 text-[13px] text-foreground/85 outline-none select-none data-highlighted:bg-hover data-highlighted:text-foreground"
                closeOnClick={false}
                onCheckedChange={(on) =>
                  onNeeds(on ? [...needs, entry.need] : needs.filter((need) => need !== entry.need))
                }
              >
                <entry.icon aria-hidden className="size-4 text-muted-foreground" weight="regular" />
                <span className="flex-1">{entry.label}</span>
                <Menu.CheckboxItemIndicator
                  keepMounted
                  className="transition-[opacity,scale] duration-150 ease-out-strong data-unchecked:scale-50 data-unchecked:opacity-0"
                >
                  <CheckIcon className="size-3.5" weight="bold" />
                </Menu.CheckboxItemIndicator>
              </Menu.CheckboxItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const count = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const money = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const month = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });

/**
 * The highlighted model's numbers, morphing in place as the cursor moves —
 * digits roll, shared characters slide — in tabular figures so the line does
 * not shuffle sideways while it changes.
 *
 * It reads a deferred copy of the model. The morph measures every character
 * it animates, and the cursor moves on every letter typed and every row the
 * pointer crosses; deferred, React commits the keystroke first and the footer
 * catches up in a render of its own, so the morph never holds up the list.
 */
function Details({ model: next }: { model: Model | undefined }) {
  const model = useDeferredValue(next);
  if (!model) return <div className="h-10" />;

  const facts = [
    `${count.format(model.context)} context`,
    `${money.format(model.cost.input)} in · ${money.format(model.cost.output)} out`,
    `Released ${month.format(new Date(model.released))}`,
    model.open ? 'Open weights' : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className="flex h-10 items-center gap-2 overflow-hidden px-4 text-[12px] text-muted-foreground tabular-nums">
      {facts.map((fact, index) => (
        <span key={index} className="flex shrink-0 items-center gap-2">
          {index ? (
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
          ) : null}
          <Morph>{fact}</Morph>
        </span>
      ))}
      <span className="ml-auto shrink-0 text-muted-foreground/70">per 1M tokens</span>
    </div>
  );
}

export { ModelPanel };
