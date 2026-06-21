import { useLiveQuery } from '@tanstack/react-db';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Bot, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';
import { active, feed, messages, roster, transcript } from '~/utils/chat';
import { client } from '~/utils/orpc';

export const Route = createFileRoute('/_auth/threads/$threadId')({
  ssr: false,
  loader: async ({ context, params }) => {
    await Promise.all([
      roster(context.user.id).preload(),
      transcript(context.user.id, params.threadId).preload(),
      active(context.user.id, params.threadId).preload(),
      feed(context.user.id, params.threadId).preload(),
    ]);
    return null;
  },
  component: ThreadComponent,
});

function ThreadComponent() {
  const ctx = Route.useRouteContext();
  const params = Route.useParams();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const owner = ctx.user.id;
  const query = useLiveQuery(roster(owner));
  const thread = query.data.find((row) => row.id === params.threadId);
  const gone = query.isReady && !thread;

  useEffect(() => {
    if (!gone) {
      return;
    }

    nav({ to: '/threads', replace: true }).catch((err: unknown) => {
      console.error('Thread redirect failed.', err);
    });
  }, [gone, nav]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send().catch((err: unknown) => {
      console.error('Message send failed.', err);
    });
  }

  async function send() {
    if (!thread || !text.trim()) {
      return;
    }

    const now = new Date().toISOString();
    const tx = messages(owner).insert({
      id: crypto.randomUUID(),
      threadId: params.threadId,
      ownerId: owner,
      runId: null,
      role: 'user',
      content: text.trim(),
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });

    setText('');
    await tx.isPersisted.promise;
    await client.run.start({ threadId: params.threadId });
  }

  if (gone) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        This thread was archived or is no longer available.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
      <header className="border-b px-3 py-2">
        <h1 className="truncate text-sm font-medium">{thread?.title ?? 'Thread'}</h1>
        <p className="text-xs text-muted-foreground">{params.threadId}</p>
      </header>
      <div className="min-h-0 overflow-y-auto p-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <Transcript id={params.threadId} ownerId={owner} />
        </div>
      </div>
      <form className="flex gap-2 border-t p-2" onSubmit={submit}>
        <Input
          value={text}
          placeholder="Ask the agent..."
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <Button disabled={!text.trim()} type="submit">
          <Send />
          Send
        </Button>
      </form>
    </div>
  );
}

function Transcript(props: { id: string; ownerId: string }) {
  const query = useLiveQuery(transcript(props.ownerId, props.id));
  const rows = query.data.toReversed();

  return (
    <>
      {rows.length ? (
        rows.map((row) => (
          <Card
            key={row.id}
            className={cn(
              '[content-visibility:auto] [contain-intrinsic-size:0_120px]',
              row.role === 'user' ? 'ml-auto max-w-[80%]' : 'mr-auto max-w-[80%]',
            )}
          >
            <CardContent>
              <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {row.role}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6">{row.content}</p>
            </CardContent>
          </Card>
        ))
      ) : query.isReady ? (
        <p className="text-sm text-muted-foreground">Send the first message.</p>
      ) : (
        <div className="min-h-20" />
      )}
      <Work id={props.id} ownerId={props.ownerId} />
    </>
  );
}

function Work(props: { id: string; ownerId: string }) {
  const running = useLiveQuery(active(props.ownerId, props.id)).data.length > 0;
  const log = useLiveQuery(feed(props.ownerId, props.id)).data.toReversed();

  return (
    <>
      {running ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Bot className="size-4 animate-pulse" />
          Agent is working...
        </div>
      ) : null}
      {log.length ? (
        <div className="border-t pt-3 text-[10px] text-muted-foreground">
          {log.map((row) => (
            <div key={row.id}>
              {row.seq}: {row.type}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
