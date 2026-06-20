import {
  events as eventCollection,
  messages as messageCollection,
  runs as runCollection,
  threads as threadCollection,
} from '@canary/sync';
import { useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Archive, Bot, Plus, Send } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { client } from '~/utils/orpc';

export const Route = createFileRoute('/_auth/threads')({
  component: ThreadsComponent,
});

function ThreadsComponent() {
  const ctx = Route.useRouteContext();
  const [tid, setTid] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const list = useMemo(
    () =>
      threadCollection({
        archive: client.thread.archive,
      }),
    [],
  );
  const threads = useLiveQuery(list).data.toSorted(
    (a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)),
  );
  const active = tid ?? threads[0]?.id ?? null;
  const msgs = useMemo(
    () =>
      active
        ? messageCollection({
            threadId: active,
            send: client.message.send,
          })
        : null,
    [active],
  );
  const runs = useMemo(() => (active ? runCollection({ threadId: active }) : null), [active]);
  const evs = useMemo(() => (active ? eventCollection({ threadId: active }) : null), [active]);
  const live = useLiveQuery(() => msgs, [msgs]);
  const liveRuns = useLiveQuery(() => runs, [runs]);
  const liveEvents = useLiveQuery(() => evs, [evs]);
  const messages = (live.data ?? []).toSorted(
    (a, b) => Number(new Date(a.createdAt)) - Number(new Date(b.createdAt)),
  );
  const running = (liveRuns.data ?? []).some((row) => row.status === 'queued' || row.status === 'running');
  const events = (liveEvents.data ?? []).toSorted((a, b) => a.seq - b.seq).slice(-6);

  async function create() {
    const res = await client.thread.create({ title: title.trim() || undefined });
    setTitle('');
    setTid(res.thread.id);
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!active || !msgs || !text.trim()) {
      return;
    }

    const now = new Date();
    const tx = msgs.insert({
      id: crypto.randomUUID(),
      threadId: active,
      ownerId: ctx.user.id,
      runId: null,
      role: 'user',
      content: text.trim(),
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });

    setText('');
    await tx.isPersisted.promise;
    await client.run.start({ threadId: active });
  }

  function archive(id: string) {
    list.update(id, (draft) => {
      draft.archivedAt = new Date();
    });
    setTid(active === id ? null : active);
  }

  return (
    <main className="grid min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[280px_1fr]">
      <aside className="min-h-0 border-r">
        <div className="flex gap-2 border-b p-2">
          <Input
            value={title}
            placeholder="Thread title"
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <Button aria-label="Create thread" size="icon" onClick={create}>
            <Plus />
          </Button>
        </div>
        <div className="grid max-h-[calc(100svh-7rem)] gap-1 overflow-y-auto p-2">
          {threads.map((row) => (
            <button
              key={row.id}
              className="group grid grid-cols-[1fr_auto] items-center gap-2 border p-2 text-left text-xs hover:bg-muted data-[active=true]:bg-muted"
              data-active={row.id === active}
              type="button"
              onClick={() => setTid(row.id)}
            >
              <span className="truncate">{row.title}</span>
              <Archive
                className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  archive(row.id);
                }}
              />
            </button>
          ))}
        </div>
      </aside>
      <section className="grid min-h-0 grid-rows-[1fr_auto]">
        <div className="min-h-0 overflow-y-auto p-3">
          {active ? (
            <div className="mx-auto grid max-w-3xl gap-3">
              {messages.map((row) => (
                <Card
                  key={row.id}
                  className={row.role === 'user' ? 'ml-auto max-w-[80%]' : 'mr-auto max-w-[80%]'}
                >
                  <CardContent>
                    <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {row.role}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6">{row.content}</p>
                  </CardContent>
                </Card>
              ))}
              {running ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Bot className="size-4 animate-pulse" />
                  Agent is working...
                </div>
              ) : null}
              {events.length ? (
                <div className="border-t pt-3 text-[10px] text-muted-foreground">
                  {events.map((row) => (
                    <div key={row.id}>
                      {row.seq}: {row.type}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Create a thread to start the realtime agent loop.
            </div>
          )}
        </div>
        <form className="flex gap-2 border-t p-2" onSubmit={send}>
          <Input
            disabled={!active}
            value={text}
            placeholder={active ? 'Ask the agent...' : 'Create a thread first'}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <Button disabled={!active || !text.trim()} type="submit">
            <Send />
            Send
          </Button>
        </form>
      </section>
    </main>
  );
}
