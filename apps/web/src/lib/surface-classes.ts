type SurfaceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const bg: Record<SurfaceLevel, string> = {
  1: 'bg-surface-1',
  2: 'bg-surface-2',
  3: 'bg-surface-3',
  4: 'bg-surface-4',
  5: 'bg-surface-5',
  6: 'bg-surface-6',
  7: 'bg-surface-7',
  8: 'bg-surface-8',
};

const shadow: Record<SurfaceLevel, string> = {
  1: 'shadow-surface-1',
  2: 'shadow-surface-2',
  3: 'shadow-surface-3',
  4: 'shadow-surface-4',
  5: 'shadow-surface-5',
  6: 'shadow-surface-6',
  7: 'shadow-surface-7',
  8: 'shadow-surface-8',
};

function level(value: number): SurfaceLevel {
  return Math.max(1, Math.min(8, value)) as SurfaceLevel;
}

function surfaceClasses(bgLevel: number, shadowLevel = bgLevel): string {
  return `${bg[level(bgLevel)]} ${shadow[level(shadowLevel)]}`;
}

export { surfaceClasses };
export type { SurfaceLevel };
