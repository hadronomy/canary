import type { ReactNode, RefObject } from 'react';

import { cubicBezier, useReducedMotion } from 'motion/react';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { Backdrop } from '~/components/backdrop/backdrop';
import shader from '~/components/backdrop/prompt.wgsl';
import { useField } from '~/components/backdrop/use-field';

/**
 * The sky behind the conversation, and the one composer it is drawn around.
 *
 * It lives in the threads layout rather than in any one screen, so starting a
 * thread never tears it down: the same field that sat behind "What are we
 * working on?" is still there in the thread, gathered around the composer and
 * withdrawn to the margins. What changes between the two is one number, `dock`,
 * and the shader draws the whole handover from it.
 *
 * Each screen registers its composer. The stage measures that element every
 * frame and tells the shader where it is, so when the composer moves the sky
 * moves with it — including mid-flight, while it is being carried from one
 * screen to the other.
 *
 * That carrying happens here too. When a composer registers just as another one
 * left, it is played from where the old one was to where it is now, on the
 * sheet curve, so the two screens read as one composer travelling rather than
 * one vanishing and another appearing.
 *
 * The move is driven from the same frame loop that measures it, not handed to
 * the compositor as a fixed FLIP. A freshly mounted thread settles its layout
 * a frame or two after it appears — the composer's resting place moves by tens
 * of pixels — and an offset computed once at mount carried that error through
 * the whole flight. Recomputed every frame against where the composer really
 * rests, the flight always ends where it should and the sky always knows where
 * the composer is. The cost is a transform write per frame on the main thread,
 * for half a second, on one element.
 */

type Mode = 'open' | 'thread';

type Stage = {
  field: ReturnType<typeof useField>;
  /** Make `node` the composer the sky is drawn around. Returns the undo. */
  hold: (node: HTMLElement, mode: Mode) => () => void;
};

const Context = createContext<Stage | null>(null);

// How long the composer takes to travel between screens, and on what curve —
// the iOS sheet curve (Ionic), which starts at once and settles long: the
// person has just pressed send, so the move should begin with them.
const TRAVEL = 480;
const sheet = cubicBezier(0.32, 0.72, 0, 1);

// How quickly the sky follows a change of screen. Exponential rather than a
// fixed-length tween so that going back mid-way turns around smoothly from
// wherever it is — about seven tenths of a second to settle.
const RATE = 4.2;

// The clearing around the composer, in CSS pixels. On the new-thread screen it
// takes in the heading above the box and a wide margin; in a thread it is the
// box and a hair more.
const OPEN = { side: 96, top: 110, bottom: 56 };
const DOCKED = { side: 8, top: 8, bottom: 8 };

// A handover only counts if the old composer left in the same moment the new
// one arrived — otherwise a composer mounting on its own would fly in from
// wherever the last one happened to be.
const FRESH = 250;

function Stage({ children }: { children: ReactNode }) {
  const field = useField({
    quiet: [0, 0, 0, 0],
    berth: [0, 0, 0, 0],
    dock: 0,
    fps: 30,
  });
  const reduce = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const held = useRef<{ node: HTMLElement; mode: Mode } | null>(null);
  const last = useRef<{ node: HTMLElement; rect: DOMRect; at: number } | null>(null);
  const dock = useRef(0);
  // A composer in flight: where it left from, when, and how far it is
  // currently drawn from where it rests.
  const trip = useRef<{
    node: HTMLElement;
    from: { left: number; top: number };
    start: number;
    shift: { x: number; y: number };
  } | null>(null);
  const motion = useRef(reduce);
  motion.current = reduce;

  useEffect(() => {
    let raf = 0;
    let then = performance.now();

    function tick(now: number) {
      const dt = Math.min((now - then) / 1000, 0.05);
      then = now;
      raf = requestAnimationFrame(tick);

      const stage = host.current;
      const hold = held.current;
      if (!stage || !hold || !hold.node.isConnected) return;

      let rect = hold.node.getBoundingClientRect();

      // Carry an arriving composer. Where it rests is read back from where it
      // is drawn minus the shift already applied, so a layout that settles
      // mid-flight is absorbed instead of carried to the end.
      const flight = trip.current;
      if (flight && flight.node === hold.node) {
        const rest = { left: rect.left - flight.shift.x, top: rect.top - flight.shift.y };
        const p = Math.min((now - flight.start) / TRAVEL, 1);
        const k = 1 - sheet(p);
        flight.shift = {
          x: (flight.from.left - rest.left) * k,
          y: (flight.from.top - rest.top) * k,
        };
        flight.node.style.translate = p < 1 ? `${flight.shift.x}px ${flight.shift.y}px` : '';
        if (p >= 1) trip.current = null;
        rect = new DOMRect(
          rest.left + (p < 1 ? flight.shift.x : 0),
          rest.top + (p < 1 ? flight.shift.y : 0),
          rect.width,
          rect.height,
        );
      }

      last.current = { node: hold.node, rect, at: now };

      const want = hold.mode === 'thread' ? 1 : 0;
      dock.current = motion.current
        ? want
        : dock.current + (want - dock.current) * (1 - Math.exp(-RATE * dt));
      const d = dock.current;
      const e = d * d * (3 - 2 * d);
      const pad = {
        side: OPEN.side + (DOCKED.side - OPEN.side) * e,
        top: OPEN.top + (DOCKED.top - OPEN.top) * e,
        bottom: OPEN.bottom + (DOCKED.bottom - OPEN.bottom) * e,
      };

      // Measured against the canvas, not the window: the shader works in its
      // own surface's coordinates, and the panel is inset from the window.
      const frame = stage.getBoundingClientRect();
      const x = (value: number) => (value - frame.left) / frame.width;
      const y = (value: number) => (value - frame.top) / frame.height;

      field.aim(x(rect.left + rect.width / 2), y(rect.top + rect.height / 2));
      field.put('berth', [
        x(rect.left),
        y(rect.top),
        rect.width / frame.width,
        rect.height / frame.height,
      ]);
      field.put('quiet', [
        x(rect.left - pad.side),
        y(rect.top - pad.top),
        (rect.width + pad.side * 2) / frame.width,
        (rect.height + pad.top + pad.bottom) / frame.height,
      ]);
      field.put('dock', d);

      // Full rate while anything is moving — the handover, a composer growing,
      // a wave on its way out — and a slow idle otherwise. At rest in a thread
      // the sky is margins and a drift nobody watches, so it barely wakes the
      // GPU at all.
      const launch = Number(field.state.current.launch);
      const moving = Math.abs(want - d) > 0.002 || (launch > 0 && launch < 1);
      field.put('fps', moving ? 60 : want ? 12 : 30);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [field]);

  const stage = useMemo<Stage>(
    () => ({
      field,
      hold(node, mode) {
        const gone = last.current;
        held.current = { node, mode };

        if (
          !motion.current &&
          gone &&
          gone.node !== node &&
          !gone.node.isConnected &&
          performance.now() - gone.at < FRESH
        ) {
          // Drawn where the old one was before the first paint, so there is no
          // frame of the composer at its destination; the loop takes it from
          // there. Measured with any earlier shift cleared, so a remount of
          // the same screen starts from where the composer rests.
          node.style.translate = '';
          const rect = node.getBoundingClientRect();
          const shift = { x: gone.rect.left - rect.left, y: gone.rect.top - rect.top };

          if (Math.hypot(shift.x, shift.y) > 1) {
            node.style.translate = `${shift.x}px ${shift.y}px`;
            trip.current = {
              node,
              from: { left: gone.rect.left, top: gone.rect.top },
              start: performance.now(),
              shift,
            };
          }
        }

        return () => {
          if (held.current?.node === node) held.current = null;
          if (trip.current?.node === node) {
            trip.current = null;
            node.style.translate = '';
          }
        };
      },
    }),
    [field],
  );

  return (
    <Context.Provider value={stage}>
      <div ref={host} className="relative h-full min-h-0">
        <Backdrop shader={shader} state={field.state} />
        {children}
      </div>
    </Context.Provider>
  );
}

/**
 * Register `ref` as the composer the sky is drawn around, for as long as the
 * calling screen is mounted. Returns the field, for the screen's own beats.
 */
function useStage(mode: Mode, ref: RefObject<HTMLElement | null>) {
  const stage = useContext(Context);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!stage || !node) return;
    return stage.hold(node, mode);
  }, [stage, mode, ref]);

  return stage?.field ?? null;
}

export { Stage, useStage };
