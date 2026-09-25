import { Menu } from '@base-ui/react/menu';
import { CaretRightIcon, CaretUpDownIcon, CheckIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';

import type { Model, ModelId } from '@canary/api/models';

import { find, models } from '@canary/api/models';
import { Mark } from '~/components/composer/mark';
import { pick, useModel } from '~/components/composer/model';
import { ease } from '~/components/composer/motion';
import { cn } from '~/lib/utils';

const frontier = models.filter((model) => model.group === 'frontier');
const open = models.filter((model) => model.group === 'open');

// How long a picked row keeps the menu up: enough for the check to land where
// it was clicked, so the choice is seen being made before the menu goes.
const LAND = 140;

/**
 * Which model the next message goes to, in the composer's control row.
 *
 * The frontier models sit at the top level. The open-weight ones are one level
 * down, which keeps the first menu short without hiding them. Picking one
 * closes the menu once the check has landed, and the trigger carries the rest:
 * the name blurs across to the new one while the pill eases to its width.
 */
function ModelPicker({ disabled }: { disabled?: boolean }) {
  const current = useModel();
  const [shown, setShown] = useState(false);
  // The trigger animates only picks made here. The stored choice lands just
  // after hydration, and playing that would animate a change nobody made.
  const [live, setLive] = useState(false);
  const timer = useRef(0);

  function choose(id: ModelId) {
    setLive(true);
    pick(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), LAND);
  }

  const chosen = find(current) ?? models[0];
  const inside = chosen.group === 'open';

  return (
    <Menu.Root
      open={shown}
      onOpenChange={(next) => {
        window.clearTimeout(timer.current);
        setShown(next);
      }}
    >
      <Menu.Trigger
        className={cn(
          // A 32px pill: the box's 24px corner less its 8px inset is 16px, so
          // the pill's ends share the corner's centre, as the send disc does.
          'flex h-8 max-w-56 items-center gap-1.5 rounded-full pr-2 pl-2.5 text-[13px] text-muted-foreground outline-none select-none',
          // Hover switches on at once; the press is the one thing that moves.
          'hover:bg-hover hover:text-foreground data-popup-open:bg-hover data-popup-open:text-foreground',
          'transition-[scale] duration-(--t-press) ease-out-strong active:scale-[0.97] motion-reduce:transition-none',
          'focus-visible:ring-2 focus-visible:ring-ring/30',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
        disabled={disabled}
      >
        <Label live={live} model={chosen} />
        <CaretUpDownIcon aria-hidden className="size-3 shrink-0 opacity-70" weight="bold" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner align="start" className="z-50 outline-none" side="top" sideOffset={8}>
          <Menu.Popup className={POPUP}>
            <Menu.RadioGroup value={current} onValueChange={(id: ModelId) => choose(id)}>
              {frontier.map((model) => (
                <Row key={model.id} model={model} />
              ))}
            </Menu.RadioGroup>

            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger
                className={cn(ROW, 'mt-1 data-popup-open:bg-hover data-popup-open:text-foreground')}
                delay={60}
                openOnHover
              >
                <span className="min-w-0 flex-1 truncate">Open weights</span>
                {/* Says where the choice is when it is one level down, so the
                    top menu never looks like nothing is picked. */}
                {inside ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Mark className="size-3" lab={chosen.lab} />
                    <span className="truncate">{chosen.name}</span>
                  </span>
                ) : null}
                <CaretRightIcon aria-hidden className="size-3 shrink-0 opacity-60" weight="bold" />
              </Menu.SubmenuTrigger>

              <Menu.Portal>
                <Menu.Positioner
                  alignOffset={-4}
                  className="z-50 outline-none"
                  side="right"
                  sideOffset={6}
                >
                  <Menu.Popup className={cn(POPUP, SUB)}>
                    <Menu.RadioGroup value={current} onValueChange={(id: ModelId) => choose(id)}>
                      {open.map((model) => (
                        <Row key={model.id} model={model} />
                      ))}
                    </Menu.RadioGroup>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// 12px outside, 4px in, 8px rows: the rows' corners sit concentric with the
// panel's. The entrance grows out of the trigger (Base UI hands the origin
// over), quick in and quicker out, the way a menu that is opened all day
// should move.
const POPUP = cn(
  'w-64 origin-(--transform-origin) rounded-[12px] bg-popover p-1 text-popover-foreground shadow-surface-5 ring-1 ring-foreground/10 outline-none',
  'transition-[opacity,scale] duration-150 ease-out-strong data-ending-style:duration-100',
  'data-starting-style:scale-[0.96] data-starting-style:opacity-0 data-ending-style:scale-[0.96] data-ending-style:opacity-0',
  'motion-reduce:transition-opacity motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100',
);

// The submenu arrives out of a short blur and a few pixels to its left, so it
// reads as sliding out of the row that opened it instead of popping beside it.
const SUB = cn(
  'transition-[opacity,scale,translate,filter]',
  'data-starting-style:-translate-x-1 data-starting-style:blur-[3px]',
  'data-ending-style:-translate-x-1 data-ending-style:blur-[3px]',
  'motion-reduce:data-starting-style:translate-x-0 motion-reduce:data-starting-style:blur-none',
);

const ROW = cn(
  'flex h-8 w-full cursor-default items-center gap-2 rounded-[8px] px-2 text-left text-[13px] text-foreground/85 outline-none select-none',
  // Instant: the highlight follows the pointer down the list.
  'data-highlighted:bg-hover data-highlighted:text-foreground',
);

function Row({ model }: { model: Model }) {
  return (
    <Menu.RadioItem className={cn(ROW, 'group/row')} closeOnClick={false} value={model.id}>
      <Tick />
      <Mark className="size-3.5 opacity-80 group-data-checked/row:opacity-100" lab={model.lab} />
      <span className="min-w-0 flex-1 truncate">{model.name}</span>
      <span className="shrink-0 text-[12px] text-muted-foreground">{model.note}</span>
    </Menu.RadioItem>
  );
}

/**
 * The choice mark: a faint ring that fills when its row is picked. The fill
 * and the check land with a small overshoot so the pick has weight; the ring
 * stays put underneath, so nothing around it shifts.
 */
function Tick() {
  return (
    <span className="relative grid size-3.5 shrink-0 place-items-center rounded-full border border-foreground/20">
      <Menu.RadioItemIndicator
        keepMounted
        className={cn(
          'absolute -inset-px grid place-items-center rounded-full bg-foreground text-background',
          'transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          'data-unchecked:scale-50 data-unchecked:opacity-0 data-unchecked:duration-100 data-unchecked:ease-out',
          'motion-reduce:transition-opacity motion-reduce:data-unchecked:scale-100',
        )}
      >
        <CheckIcon className="size-2.5" weight="bold" />
      </Menu.RadioItemIndicator>
    </span>
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
      transition={still ? { duration: 0 } : { duration: 0.32, ease }}
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
  coming: (still: boolean) => (still ? { opacity: 1 } : { opacity: 0, filter: 'blur(4px)', y: 6 }),
  shown: (still: boolean) => ({
    opacity: 1,
    filter: 'blur(0px)',
    y: 0,
    transition: { duration: still ? 0 : 0.24, ease },
  }),
  gone: (still: boolean) =>
    still
      ? { opacity: 0, transition: { duration: 0 } }
      : { opacity: 0, filter: 'blur(4px)', y: -6, transition: { duration: 0.2, ease } },
};

export { ModelPicker };
