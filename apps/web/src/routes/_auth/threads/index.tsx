import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { AgentPrompt } from '~/components/agent-prompt';
import { Backdrop, LEAVE } from '~/components/backdrop/backdrop';
import shader from '~/components/backdrop/prompt.wgsl';
import { HOLD, useField } from '~/components/backdrop/use-field';
import { shellRoutes } from '~/components/shell/routes';
import { Swap } from '~/lib/motion';
import { cn } from '~/lib/utils';
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
  const reduce = useReducedMotion();

  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);
  // Only a slow start earns a status line. A normal one is carried by the wave
  // and the move, and a heading swapping at the same moment is a third thing
  // in motion with nothing new to say.
  const [slow, setSlow] = useState(false);
  // The sky's exit, in two steps: `leaving` sends it forward and out while the
  // wave is still crossing it, `gone` takes the canvas off the page before the
  // view transition is taken.
  const [sky, setSky] = useState<'here' | 'leaving' | 'gone'>('here');

  const owner = ctx.user.id;

  useLayoutEffect(() => {
    const node = box.current;
    const stage = host.current;
    if (!node || !stage) return;

    // Measured rather than computed once: the block changes height when an
    // error line arrives.
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

      field.aim(x(box_.left + box_.width / 2), y(box_.top + box_.height / 2));

      // The measured block already contains the heading, so the clearing only
      // needs a margin around it rather than a guess at how far the type
      // reaches above the box.
      field.put('quiet', [
        x(box_.left - 96),
        y(box_.top - 56),
        (box_.width + 192) / frame.width,
        (box_.height + 112) / frame.height,
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
    if (!busy) {
      setSlow(false);
      return;
    }

    const id = setTimeout(() => setSlow(true), 900);
    return () => clearTimeout(id);
  }, [busy]);

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

      // The field answers the send at once, and the thread is made while the
      // wave is out. The page changes only once the wave has most of the way
      // to go behind it, so the screen that is left holds the moment rather
      // than a sky caught at rest.
      const began = performance.now();
      if (!reduce) field.launch(true);
      setSky('leaving');

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

      // The draft stays in the box: the transition carries the composer across
      // as it looks at this moment, and an emptied box would travel as one
      // that had already forgotten what was asked. The thread's own composer
      // is empty, and it takes over at the end of the move.
      const wait = reduce ? 0 : HOLD - (performance.now() - began);
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));

      // A live WebGPU canvas inside a view transition snapshot can hang the
      // renderer — it froze headless Chrome outright. By now the sky has
      // already faded to nothing, so removing it costs no frame of the effect,
      // and the snapshot is left with nothing it can choke on.
      flushSync(() => setSky('gone'));

      await nav({
        to: '/threads/$threadId',
        params: { threadId: id },
        viewTransition: { types: ['open-thread'] },
      });
    },
    [busy, field, nav, owner, reduce],
  );

  return (
    <div
      ref={host}
      className="relative grid h-full min-h-0 grid-rows-[1fr_auto_0.62fr] overflow-hidden px-4"
    >
      {sky === 'gone' ? null : (
        <Backdrop className={cn(sky === 'leaving' && LEAVE)} shader={shader} state={field.state} />
      )}

      {/* Heading and composer are one block, centred together. */}
      <div ref={box} className="relative z-10 row-start-2 w-full max-w-3xl justify-self-center">
        <h1 className="mx-auto mb-5 max-w-lg text-center text-[26px] leading-[1.2] tracking-[-0.025em] text-balance">
          <Swap value={slow ? 'Opening the thread…' : 'What are we working on?'} />
        </h1>

        {/* Not disabled while the thread is made: a composer that greys out on
            send travels to the thread looking broken. The busy guard in
            `start` is what stops a second send. */}
        <AgentPrompt
          className="p-0"
          error={err}
          name="composer"
          pristine
          value={draft}
          onSubmit={(body) => {
            start(body).catch((cause: unknown) => {
              setBusy(false);
              setSky('here');
              field.launch(false);
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
