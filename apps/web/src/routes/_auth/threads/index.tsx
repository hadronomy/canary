import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth/threads/')({
  component: ThreadsIndex,
});

function ThreadsIndex() {
  return (
    <div className="grid h-full place-items-center p-4 text-sm text-muted-foreground">
      Pick a thread on the right, or create one to test realtime sync.
    </div>
  );
}
