import { createFileRoute } from '@tanstack/react-router';

import { shellRoutes } from '~/components/shell/routes';

export const Route = createFileRoute('/_auth/threads/')({
  staticData: {
    shell: shellRoutes.chat,
  },
  component: ThreadsIndex,
});

function ThreadsIndex() {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-sm rounded-[1.5rem] border border-line bg-surface/80 p-6 ">
        <p className="text-sm font-medium text-foreground">Pick a thread</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Select a thread from the sidebar, or create one to test realtime sync.
        </p>
      </div>
    </div>
  );
}
