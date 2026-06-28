const ease = [0.16, 1, 0.3, 1] as const;

const instantTransition = {
  duration: 0,
} as const;

const composerMount = {
  hidden: {
    opacity: 0,
    y: 8,
    filter: 'blur(2px)',
  },
  reducedHidden: {
    opacity: 0,
  },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.22,
      ease,
    },
  },
};

const surfaceVariants = {
  commanding: {
    borderColor: 'var(--canary-line-strong)',
    borderTopLeftRadius: '1.18rem',
    borderTopRightRadius: '1.18rem',
    boxShadow: 'none',
    y: 1,
    transition: { duration: 0.2, ease },
  },
  disabled: {
    borderColor: 'var(--canary-line)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: 'none',
    y: 0,
    transition: { duration: 0.18, ease },
  },
  error: {
    borderColor: 'color-mix(in oklch, var(--canary-danger) 34%, transparent)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: 'none',
    y: 0,
    transition: { duration: 0.18, ease },
  },
  focused: {
    borderColor: 'var(--canary-line-strong)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: 'none',
    y: 0,
    transition: { duration: 0.18, ease },
  },
  resting: {
    borderColor: 'var(--canary-line)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: 'none',
    y: 0,
    transition: { duration: 0.18, ease },
  },
  running: {
    borderColor: 'var(--canary-line-strong)',
    borderTopLeftRadius: '1.35rem',
    borderTopRightRadius: '1.35rem',
    boxShadow: 'none',
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
      'linear-gradient(135deg, color-mix(in oklch, var(--canary-danger) 12%, transparent), transparent 38%, transparent)',
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

const railSectionVariants = {
  closed: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.14, ease },
  },
  open: {
    opacity: 1,
    height: 'auto',
    transition: { duration: 0.18, ease },
  },
};

export {
  auraVariants,
  composerMount,
  ease,
  instantTransition,
  railSectionVariants,
  surfaceVariants,
};
