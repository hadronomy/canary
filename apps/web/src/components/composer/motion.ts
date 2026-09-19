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
const surfaceVariants = {
  commanding: {
    borderColor: 'color-mix(in oklch, var(--primary) 34%, transparent)',
    borderTopLeftRadius: '0px',
    borderTopRightRadius: '0px',
    transition: { duration: 0.2, ease },
  },
  disabled: {
    borderColor: 'color-mix(in oklch, var(--surface-6) 40%, transparent)',
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
  error: {
    borderColor: 'color-mix(in oklch, var(--destructive) 46%, transparent)',
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
  focused: {
    borderColor: 'color-mix(in oklch, var(--primary) 34%, transparent)',
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
  resting: {
    borderColor: 'color-mix(in oklch, var(--surface-6) 60%, transparent)',
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
    transition: { duration: 0.18, ease },
  },
  running: {
    borderColor: 'color-mix(in oklch, var(--primary) 26%, transparent)',
    borderTopLeftRadius: 'var(--radius-composer)',
    borderTopRightRadius: 'var(--radius-composer)',
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

export { auraVariants, composerMount, ease, instantTransition, surfaceVariants };
