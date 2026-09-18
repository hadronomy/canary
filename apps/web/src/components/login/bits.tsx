import { useEffect, useRef, useState } from 'react';

/**
 * Swap text in place: the outgoing line leaves upward and blurred, the incoming
 * one arrives from below. Keying on the value is what restarts the animation;
 * the blur is what stops it reading as two separate objects passing.
 */
function Swap({ value }: { value: string }) {
  return (
    <span className="relative inline-grid overflow-hidden">
      <span
        key={value}
        className="col-start-1 row-start-1 motion-reduce:!animate-none"
        style={{ animation: 'swap-in 300ms var(--ease-strong) both' }}
      >
        {value}
      </span>
      <style>{`@keyframes swap-in{from{opacity:0;transform:translateY(0.45em);filter:blur(3px)}to{opacity:1;transform:none;filter:blur(0)}}`}</style>
    </span>
  );
}

/** Cross-blur one slot of a stack in or out. */
function Fade({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <span
      aria-hidden={!show}
      className="transition-[opacity,filter,transform] duration-200 ease-out"
      style={{
        opacity: show ? 1 : 0,
        filter: show ? 'blur(0)' : 'blur(2px)',
        transform: show ? 'none' : 'scale(0.96)',
      }}
    >
      {children}
    </span>
  );
}

function Spin({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className ?? 'size-4 animate-spin'}
      role="img"
      aria-label="Working"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Stroke-drawn checkmark. The dash length is measured from the path rather
 *  than guessed, or the stroke either pre-reveals or overdraws. */
function Check({ className }: { className?: string }) {
  const path = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(24);

  useEffect(() => {
    if (path.current) setLen(Math.ceil(path.current.getTotalLength()) + 1);
  }, []);

  return (
    <svg
      viewBox="0 0 16 16"
      className={`t-check ${className ?? 'size-4'}`}
      style={{ ['--len' as string]: len }}
      role="img"
      aria-label="Signed in"
    >
      <path
        ref={path}
        d="M3.5 8.5 6.5 11.5 12.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// Per-segment easing rather than one curve across the whole travel: a rejection
// should feel like it hit something, and a single ease reads as a wobble.
const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-8px)', offset: 0.15 },
  { transform: 'translateX(7px)', offset: 0.3 },
  { transform: 'translateX(-5px)', offset: 0.45 },
  { transform: 'translateX(4px)', offset: 0.6 },
  { transform: 'translateX(-2px)', offset: 0.78 },
  { transform: 'translateX(0)' },
];

/**
 * Shake an element to reject an attempt.
 *
 * Driven through the Web Animations API rather than a CSS class, because every
 * call restarts cleanly. The class-and-reflow dance needs a forced layout read
 * to replay, and keying the element to remount it would throw away whatever the
 * person had already typed — which is the last thing a rejected form should do.
 */
function jolt(node: HTMLElement | null) {
  if (!node) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  node.animate(SHAKE, { duration: 380, easing: 'cubic-bezier(0.36, 0, 0.66, -0.56)' });
}

export { Check, Fade, Spin, Swap, jolt };
