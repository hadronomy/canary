import type { ReactNode } from 'react';

import { cn } from '~/lib/utils';

function Surface(props: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[1.5rem] border border-line bg-surface', props.className)}>
      {props.children}
    </section>
  );
}

export { Surface };
