const ease = [0.16, 1, 0.3, 1] as const;

const instantTransition = {
  duration: 0,
} as const;

const composerMount = {
  hidden: {
    opacity: 0,
    y: 8,
  },
  reducedHidden: {
    opacity: 0,
  },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.22,
      ease,
    },
  },
};

// The surface's fill, blur and edge live in `.canary-composer`; these variants
// only say what changes with state. They deliberately do not set `boxShadow`:
// an inline `none` here was flattening the layered glass the class builds.
// Only the top corners, which square off when the slash menu docks onto them.
//
// Border colour used to live here too, as `color-mix()` values Motion cannot
// interpolate — it warned and snapped on every state change. CSS transitions
// handle `color-mix` without complaint, so the edge is driven off
// `data-state` in the stylesheet and this is left with the one property that
// genuinely needs a variant.
const surfaceVariants = {
  commanding: {
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    transition: { duration: 0.2, ease },
  },
  disabled: {
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
  error: {
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
  focused: {
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
  resting: {
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
  running: {
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
};

// The strip and the slash menu want the same slot above the box, so the strip
// steps aside when the menu takes it. The menu is opaque and would cover it
// regardless; without this the strip is still there underneath, peeking around
// the menu's edges while it scales open.
const stripVariants = {
  hidden: {
    opacity: 0,
    y: 4,
    transition: { duration: 0.14, ease },
  },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.18, ease },
  },
};

const auraVariants = {
  commanding: {
    opacity: 0.68,
    background:
      'linear-gradient(135deg, color-mix(in oklch, var(--foreground) 7%, transparent), transparent 42%)',
  },
  disabled: { opacity: 0 },
  error: {
    opacity: 1,
    background:
      'linear-gradient(135deg, color-mix(in oklch, var(--destructive) 12%, transparent), transparent 38%, transparent)',
  },
  focused: {
    opacity: 0.7,
    background:
      'linear-gradient(135deg, color-mix(in oklch, var(--foreground) 7%, transparent), transparent 44%)',
  },
  resting: {
    opacity: 0.45,
    background:
      'linear-gradient(135deg, color-mix(in oklch, var(--foreground) 4.5%, transparent), transparent 42%)',
  },
  running: {
    opacity: 0.65,
    background:
      'linear-gradient(135deg, color-mix(in oklch, var(--foreground) 6.5%, transparent), transparent 42%)',
  },
};

export { auraVariants, composerMount, ease, instantTransition, stripVariants, surfaceVariants };
