import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AgentPrompt } from '~/components/agent-prompt';
import { useStage } from '~/components/backdrop/stage';
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
  const reduce = useReducedMotion();
  const anchor = useRef<HTMLDivElement>(null);
  const field = useStage('open', anchor);

  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);
  // Only a slow start earns a status line. A normal one is carried by the wave
  // and the move, and a heading swapping at the same moment is a third thing
  // in motion with nothing new to say.
  const [slow, setSlow] = useState(false);
  // Set the moment a message is sent: the heading and the question let go
  // while the thread is made, so the composer leaves the screen empty.
  const [sending, setSending] = useState(false);

  const owner = ctx.user.id;

  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }

    const id = setTimeout(() => setSlow(true), 900);
    return () => clearTimeout(id);
  }, [busy]);

  useEffect(() => {
    if (!err || !field) return;
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

      // The field answers the send at once, and the thread is made while the
      // wave is out. The wave is not waited on: the sky outlives this screen,
      // so it keeps crossing while the composer travels.
      const began = performance.now();
      if (!reduce) field?.launch(true);
      setSending(true);

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

      // Long enough for the heading and the question to have let go, so the
      // composer leaves with nothing in it and arrives the same way.
      const wait = reduce ? 0 : LET_GO - (performance.now() - began);
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));

      await nav({ to: '/threads/$threadId', params: { threadId: id } });
    },
    [busy, field, nav, owner, reduce],
  );

  return (
    <div className="relative grid h-full min-h-0 grid-rows-[1fr_auto_0.62fr] overflow-hidden px-4">
      {/* Heading and composer are one block, centred together. */}
      <div
        className="canary-opening relative z-10 row-start-2 w-full max-w-3xl justify-self-center"
        data-sending={sending || undefined}
      >
        <h1 className="t-arrive mx-auto mb-5 max-w-lg text-center text-[26px] leading-[1.2] tracking-[-0.025em] text-balance">
          <Swap value={slow ? 'Opening the thread…' : 'What are we working on?'} />
        </h1>

        {/* Not disabled while the thread is made: a composer that greys out on
            send travels to the thread looking broken. The busy guard in
            `start` is what stops a second send. */}
        <AgentPrompt
          anchor={anchor}
          className="p-0"
          error={err}
          pristine
          value={draft}
          onSubmit={(body) => {
            start(body).catch((cause: unknown) => {
              setBusy(false);
              setSending(false);
              field?.launch(false);
              console.error('Thread create failed.', cause);
              setErr(cause instanceof Error ? cause.message : 'Could not start the thread.');
            });
          }}
          onValue={(value) => {
            setDraft(value);
            field?.beat();
          }}
        />
      </div>
    </div>
  );
}

/**
 * How long the new-thread screen holds after a send, in milliseconds: the
 * length of the heading's and the question's fade, and no longer.
 */
const LET_GO = 160;

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
