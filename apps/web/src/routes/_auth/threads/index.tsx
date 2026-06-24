import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/threads/')({
  component: ThreadsIndex,
});

function ThreadsIndex() {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-sm rounded-[1.5rem] border border-white/10 bg-black/20 p-6 shadow-[0_24px_80px_oklch(0_0_0/28%)]">
        <p className="text-sm font-medium text-foreground">Pick a thread</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Select a thread from the sidebar, or create one to test realtime sync.
        </p>
      </div>
    </div>
  );
}
