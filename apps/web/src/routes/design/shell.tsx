import { FolderSimpleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { createFileRoute } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { z } from 'zod';

import { AgentPrompt } from '~/components/agent-prompt';
import { ToolChips } from '~/components/agent/tool-chips';
import { AssistantPending, UserMessage } from '~/components/agent/turn';
import { Stage, useStage } from '~/components/backdrop/stage';
import { Account } from '~/components/shell/account';
import { Brand } from '~/components/shell/brand';
import { Nav } from '~/components/shell/nav';
import { ThreadRow } from '~/components/shell/thread-row';
import { Button } from '~/components/ui/button';
import { Swap } from '~/lib/motion';
import { cn } from '~/lib/utils';

// Preview-only. The shell with fixture data, so the redesign can be looked at
// without the sync stack running. Delete once it has served its purpose.
export const Route = createFileRoute('/design/shell')({
  validateSearch: z.object({ v: z.coerce.string().optional() }),
  component: Preview,
});

const USER = {
  id: 'preview',
  name: 'Pablo Hernández',
  email: 'hadronomy@gmail.com',
  image: null,
};

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

const GROUPS = [
  {
    label: 'Today',
    rows: [
      ['Rewrite the sync keepalive proxy', 3, 'done'],
      ['Why does the composer drop focus on send?', 18, 'running'],
      ['Draft the varlock migration notes', 64, 'idle'],
      ['Electric shape ownership', 190, 'failed'],
    ] as const,
  },
  {
    label: 'Recent',
    rows: [
      ['Token exchange RFC 8693 plan', 1500, 'done'],
      ['Rust rate limiting with tower_governor', 2600, 'done'],
      ['Effect v4 migration sweep', 4300, 'idle'],
    ] as const,
  },
];

const TASKS = [
  {
    id: '1',
    name: 'read',
    status: 'done' as const,
    chip: 'packages/sync/src/index.ts',
  },
  {
    id: '2',
    name: 'grep',
    status: 'done' as const,
    chip: 'apps/web/src/components/shell',
    detail:
      'apps/web/src/components/shell/threads.tsx:58\napps/web/src/components/shell/sidebar.tsx:37',
  },
  { id: '3', name: 'bash', status: 'running' as const, chip: 'bun run check-types' },
  { id: '4', name: 'edit', status: 'pending' as const },
] as const;

function Preview() {
  const params = Route.useSearch();
  const [sent, setSent] = useState<string | null>(null);

  let seq = 0;

  return (
    <div className="grid h-svh grid-cols-[15.5rem_minmax(0,1fr)] overflow-hidden bg-background p-2 text-foreground">
      <>
        <aside className="h-full min-h-0 pr-2">
          <div className="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-3 py-1">
            <Brand />

            <Nav />

            <section className="grid min-h-0 grid-rows-[auto_1fr] gap-1">
              <header className="relative flex h-8 items-center justify-between">
                <h2 className="px-2 text-[13px] text-muted-foreground">Threads</h2>
                <Button
                  aria-label="Search threads"
                  className="mr-1 size-6 text-muted-foreground"
                  size="icon-sm"
                  variant="ghost"
                >
                  <MagnifyingGlassIcon weight="regular" />
                </Button>
              </header>

              <div className="min-h-0 overflow-y-auto pr-1 pb-8 [mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]">
                <div className="grid gap-3">
                  {GROUPS.map((entry) => (
                    <section key={entry.label}>
                      <div className="flex h-7 items-center gap-1.5 px-2">
                        <FolderSimpleIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-muted-foreground/70"
                          weight="regular"
                        />
                        <h3 className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                          {entry.label}
                        </h3>
                        <span className="text-[12.5px] tabular-nums text-muted-foreground/60">
                          {entry.rows.length}
                        </span>
                      </div>

                      <div className="grid gap-px">
                        {entry.rows.map(([title, minutes, state], index) => (
                          <ThreadRow
                            active={seq++ === 1}
                            id={`preview-${title.length}-${minutes}`}
                            index={index}
                            key={title}
                            state={state}
                            title={title}
                            updated={ago(minutes)}
                            onArchive={() => undefined}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </section>

            <footer>
              <Account ready threads={7} user={USER} onSignout={() => undefined} />
            </footer>
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden rounded-(--radius-shell) bg-surface-2 shadow-surface-2">
          <Stage>
            {sent !== null ? (
              <Thread text={sent} onBack={() => setSent(null)} />
            ) : (
              <Open tasks={params.v === 'tasks'} onSend={setSent} />
            )}
          </Stage>
        </main>
      </>
    </div>
  );
}

/**
 * The new-thread screen with fixture data, sending into a mock thread through
 * the same sequence the real route runs: the wave goes out, the heading and
 * the question let go, and the composer travels while the sky follows it.
 */
function Open({ onSend, tasks }: { onSend: (text: string) => void; tasks: boolean }) {
  const reduce = useReducedMotion();
  const anchor = useRef<HTMLDivElement>(null);
  const field = useStage('open', anchor);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  return (
    <div
      className={cn(
        'relative h-full min-h-0 overflow-hidden px-4',
        tasks ? 'grid grid-rows-[1fr_auto]' : 'grid grid-rows-[1fr_auto_0.62fr]',
      )}
    >
      {tasks ? (
        <div className="relative z-10 min-h-0 overflow-y-auto py-8">
          <div className="mx-auto w-full max-w-3xl">
            <ToolChips steps={TASKS} />
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'canary-opening relative z-10 w-full max-w-3xl pb-3',
          !tasks && 'row-start-2 justify-self-center',
        )}
        data-sending={sending || undefined}
      >
        {tasks ? null : (
          <h1 className="t-arrive mx-auto mb-5 max-w-lg text-center text-[26px] leading-[1.2] tracking-[-0.025em] text-balance">
            <Swap value="What are we working on?" />
          </h1>
        )}

        <AgentPrompt
          anchor={anchor}
          className="p-0"
          error={null}
          pristine
          value={draft}
          onSubmit={(text) => {
            if (!reduce) field?.launch(true);
            setSending(true);
            window.setTimeout(() => onSend(text), reduce ? 0 : 160);
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

/** A thread as it looks the moment it opens: your message, and the wait. */
function Thread({ onBack, text }: { onBack: () => void; text: string }) {
  const [draft, setDraft] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  useStage('thread', anchor);

  return (
    <div className="relative grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
      <header className="t-arrive flex min-w-0 items-center justify-between gap-2 px-4 py-2.5">
        <h1 className="min-w-0 truncate text-[13px] font-medium">{text}</h1>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </header>

      <div className="t-arrive min-h-0 overflow-y-auto px-3 pt-6">
        <div className="mx-auto w-full max-w-3xl space-y-8">
          <UserMessage content={text} />
          <AssistantPending />
        </div>
      </div>

      <AgentPrompt
        anchor={anchor}
        error={null}
        running
        value={draft}
        onCancel={() => undefined}
        onSubmit={() => setDraft('')}
        onValue={setDraft}
      />
    </div>
  );
}
