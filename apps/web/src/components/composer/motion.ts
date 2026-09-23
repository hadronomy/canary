const ease = [0.16, 1, 0.3, 1] as const;

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

export { composerMount, ease, surfaceVariants };
