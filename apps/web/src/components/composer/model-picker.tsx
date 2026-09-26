import { Popover } from '@base-ui/react/popover';
import { CaretUpDownIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { Model, ModelId } from '@canary/api/models';

import { find, models } from '@canary/api/models';
import { Mark } from '~/components/composer/mark';
import { pick, useModel } from '~/components/composer/model';
import { ModelPanel } from '~/components/composer/model-panel';
import { cn } from '~/lib/utils';

// How long a picked row keeps the panel up: long enough for the current-model
// badge to spring onto it and settle, so the choice is seen landing before the
// panel goes. Picking is occasional, so the wait costs nothing felt.
const LAND = 240;

// The trigger's name change. Quint-out rather than the app's strong ease-out:
// that curve spends almost all of its travel in the first two frames, which is
// right for a press and wrong for a blur that is meant to be seen clearing.
const SETTLE = [0.22, 1, 0.36, 1] as const;

/**
 * Which model the next message goes to, in the composer's control row.
 *
 * The trigger is a pill naming the model; the panel it opens is a searchable
 * catalog, sorted onto shelves by lab with favourites first. Picking closes
 * the panel once the row has taken the pick, and the trigger carries the rest:
 * the name blurs across to the new one while the pill eases to its width.
 */
function ModelPicker({ disabled }: { disabled?: boolean }) {
  const current = useModel();
  const [shown, setShown] = useState(false);
  // The trigger animates only picks made here. The stored choice lands just
  // after hydration, and playing that would animate a change nobody made.
  const [live, setLive] = useState(false);
  const timer = useRef(0);

  // Stable, because every row of the panel is memoised on it: a new function
  // per render of the composer would re-render the whole catalog on every
  // letter typed into the search.
  const choose = useCallback((id: ModelId) => {
    setLive(true);
    pick(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), LAND);
  }, []);

  return (
    <Popover.Root
      open={shown}
      onOpenChange={(next) => {
        window.clearTimeout(timer.current);
        setShown(next);
      }}
    >
      <Popover.Trigger
        className={cn(
          // A 32px pill: the box's 24px corner less its 8px inset is 16px, so
          // the pill's ends share the corner's centre, as the send disc does.
          'flex h-8 max-w-60 items-center gap-1.5 rounded-full pr-2 pl-2.5 text-[13px] text-muted-foreground outline-none select-none',
          // Hover switches on at once; the press is the one thing that moves.
          'hover:bg-hover hover:text-foreground data-popup-open:bg-hover data-popup-open:text-foreground',
          'transition-[scale] duration-(--t-press) ease-out-strong active:scale-[0.97] motion-reduce:transition-none',
          'focus-visible:ring-2 focus-visible:ring-ring/30',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
        disabled={disabled}
      >
        <Label live={live} model={find(current) ?? models[0]} />
        <CaretUpDownIcon aria-hidden className="size-3 shrink-0 opacity-70" weight="bold" />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          align="start"
          alignOffset={-6}
          className="z-50 outline-none"
          // Above the composer or, if there is no room, below it — never
          // beside it, where it would cover the text being written.
          collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
          collisionPadding={12}
          side="top"
          sideOffset={10}
        >
          {/* 16px outside, 6px in, 10px rows: the rows' corners sit
              concentric with the panel's. It grows out of the trigger — Base
              UI hands over the origin — and lifts a few pixels as it comes. */}
          <Popover.Popup
            aria-label="Choose a model"
            className={cn(
              'w-[min(34rem,calc(100vw-2rem))] origin-(--transform-origin) overflow-hidden rounded-[16px] bg-popover pt-0.5 text-popover-foreground shadow-surface-5 ring-1 ring-foreground/10 outline-none',
              'transition-[opacity,scale,translate] duration-200 ease-out-strong data-ending-style:duration-120',
              'data-starting-style:translate-y-1 data-starting-style:scale-[0.97] data-starting-style:opacity-0',
              'data-ending-style:translate-y-0.5 data-ending-style:scale-[0.98] data-ending-style:opacity-0',
              'motion-reduce:transition-opacity motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-starting-style:scale-100',
            )}
          >
            <ModelPanel current={current} onPick={choose} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The trigger's mark and name. A new pick blurs across rather than cutting,
 * the incoming name rising a few pixels as the old one sinks; the width eases
 * from one name to the next, so the pill never snaps its length.
 *
 * Old and new share one grid cell, so a name on its way out never holds space
 * the incoming one needs, however many picks overlap. The pill's width follows
 * the incoming name alone.
 *
 * Whether a change animates is handed to the exiting name through `custom`:
 * an element on its way out keeps the props it last rendered with, and those
 * can predate the pick that is removing it.
 */
function Label({ live, model }: { live: boolean; model: Model }) {
  const reduce = useReducedMotion();
  const cell = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | 'auto'>('auto');
  const still = Boolean(reduce) || !live;

  useLayoutEffect(() => {
    const node = cell.current?.querySelector<HTMLElement>(`[data-model="${model.id}"]`);
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.offsetWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [model.id]);

  return (
    <motion.span
      animate={{ width }}
      className="flex min-w-0 overflow-hidden"
      initial={false}
      transition={still ? { duration: 0 } : { duration: 0.46, ease: SETTLE }}
    >
      <span ref={cell} className="grid w-max">
        <AnimatePresence custom={still} initial={false}>
          <motion.span
            key={model.id}
            animate="shown"
            className="col-start-1 row-start-1 flex items-center gap-1.5 justify-self-start whitespace-nowrap"
            custom={still}
            data-model={model.id}
            exit="gone"
            initial="coming"
            variants={SWAP}
          >
            <Mark className="size-3.5" lab={model.lab} />
            {model.name}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.span>
  );
}

const SWAP = {
  coming: (still: boolean) => (still ? { opacity: 1 } : { opacity: 0, filter: 'blur(6px)', y: 7 }),
  shown: (still: boolean) => ({
    opacity: 1,
    filter: 'blur(0px)',
    y: 0,
    transition: { duration: still ? 0 : 0.46, ease: SETTLE },
  }),
  gone: (still: boolean) =>
    still
      ? { opacity: 0, transition: { duration: 0 } }
      : { opacity: 0, filter: 'blur(6px)', y: -7, transition: { duration: 0.34, ease: SETTLE } },
};

export { ModelPicker };
