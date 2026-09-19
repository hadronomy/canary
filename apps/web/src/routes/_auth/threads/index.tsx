import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AgentPrompt } from '~/components/agent-prompt';
import { Backdrop } from '~/components/backdrop/backdrop';
import shader from '~/components/backdrop/prompt.wgsl';
import { useField } from '~/components/backdrop/use-field';
import { shellRoutes } from '~/components/shell/routes';
import { Swap } from '~/lib/motion';
import { list, messages } from '~/utils/chat';

export const Route = createFileRoute('/_auth/threads/')({
  staticData: {
    shell: shellRoutes.thread,
  },
  component: NewThread,
});

/**
 * Where a thread starts.
 *
 * There is no title field. Naming a conversation before it has happened
 * produces "test 3" and "asdf"; the first message already says what it is
 * about, so that is what names it.
 */
function NewThread() {
  const ctx = Route.useRouteContext();
  const nav = useNavigate();
  const field = useField({ quiet: [0, 0, 0, 0] });

  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);

  const owner = ctx.user.id;

  useLayoutEffect(() => {
    const node = box.current;
    const stage = host.current;
    if (!node || !stage) return;

    // The field clears where the composer sits, measured rather than computed
    // once: the composer grows as the tray opens and as an error line arrives.
    function clear() {
      if (!node || !stage) return;
      // Measured against the canvas, not the window. The shader works in its
      // own surface's coordinates, and the panel is inset — reading these off
      // `innerWidth` put the clearing a couple of hundred pixels left of the
      // composer and left the type sitting on the busiest part of the field.
      const box_ = node.getBoundingClientRect();
      const frame = stage.getBoundingClientRect();
      const x = (value: number) => (value - frame.left) / frame.width;
      const y = (value: number) => (value - frame.top) / frame.height;

      field.aim(x(box_.left + box_.width / 2), y(box_.top - 20));

      // The clearing has to reach the heading, not just the composer: the line
      // sits above the box, and that is the one place the type has to win.
      field.put('quiet', [
        x(box_.left - 120),
        y(box_.top - 150),
        (box_.width + 240) / frame.width,
        (box_.height + 210) / frame.height,
      ]);
    }

    clear();
    const ro = new ResizeObserver(clear);
    ro.observe(node);
    ro.observe(stage);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [field]);

  useEffect(() => {
    if (!err) return;
    field.fault(true);
    const id = setTimeout(() => field.fault(false), 900);
    return () => clearTimeout(id);
  }, [err, field]);

  const start = useCallback(
    async (body: string) => {
      const content = body.trim();

      if (!content || busy) {
        return;
      }

      setBusy(true);
      setErr(null);

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      // The thread has to land before the message does, or the message arrives
      // pointing at a row the server has never heard of.
      await list(owner).insert({
        id,
        ownerId: owner,
        title: name(content),
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      }).isPersisted.promise;

      messages(owner).insert({
        id: crypto.randomUUID(),
        threadId: id,
        ownerId: owner,
        runId: null,
        role: 'user',
        content,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      });

      setDraft('');
      await nav({ to: '/threads/$threadId', params: { threadId: id } });
    },
    [busy, nav, owner],
  );

  return (
    <div ref={host} className="relative grid h-full min-h-0 grid-rows-[1fr_auto] overflow-hidden">
      <Backdrop shader={shader} state={field.state} />

      <div className="relative z-10 grid min-h-0 place-items-end justify-items-center px-6 pb-10">
        <h1 className="max-w-lg text-center text-[26px] leading-[1.2] tracking-[-0.025em] text-balance">
          <Swap value={busy ? 'Opening the thread…' : 'What are we working on?'} />
        </h1>
      </div>

      <div ref={box} className="relative z-10 px-3 pb-3">
        <AgentPrompt
          className="mx-auto max-w-3xl rounded-(--radius-shell) border-0 bg-transparent px-0 pt-0 backdrop-blur-none"
          disabled={busy}
          error={err}
          pristine
          value={draft}
          onSubmit={(body) => {
            start(body).catch((cause: unknown) => {
              setBusy(false);
              console.error('Thread create failed.', cause);
              setErr(cause instanceof Error ? cause.message : 'Could not start the thread.');
            });
          }}
          onValue={(value) => {
            setDraft(value);
            field.beat();
          }}
        />
      </div>
    </div>
  );
}

// A title is a glance, not a summary: one line, cut at a word boundary so it
// does not end mid-syllable.
function name(content: string) {
  const line = content.split('\n')[0]?.trim() ?? '';

  if (line.length <= 60) {
    return line || 'New thread';
  }

  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(' ');

  return `${space > 24 ? cut.slice(0, space) : cut}…`;
}
