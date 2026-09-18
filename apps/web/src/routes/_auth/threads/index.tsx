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
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);

  const owner = ctx.user.id;

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;

    // The field clears where the composer sits, measured rather than computed
    // once: the composer grows as the tray opens and as an error line arrives.
    function clear() {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      field.aim(
        (rect.left + rect.width / 2) / innerWidth,
        (rect.top + rect.height / 2) / innerHeight,
      );
      field.put('quiet', [
        (rect.left - 120) / innerWidth,
        (rect.top - 60) / innerHeight,
        (rect.width + 240) / innerWidth,
        (rect.height + 120) / innerHeight,
      ]);
    }

    clear();
    const ro = new ResizeObserver(clear);
    ro.observe(node);
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
    <div className="relative grid h-full min-h-0 grid-rows-[1fr_auto] overflow-hidden bg-surface-1">
      <Backdrop shader={shader} state={field.state} />

      <div className="relative z-10 grid min-h-0 place-items-end justify-items-center px-6 pb-4">
        <h1 className="max-w-lg text-center text-[22px] leading-[1.25] tracking-[-0.02em] text-balance">
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
