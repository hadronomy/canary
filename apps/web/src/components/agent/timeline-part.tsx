import type { ReactNode } from 'react';

import { cn } from '~/lib/utils';

function TimelinePart(props: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flow-root min-w-0 max-w-full', props.className)}>{props.children}</div>
  );
}

export { TimelinePart };
