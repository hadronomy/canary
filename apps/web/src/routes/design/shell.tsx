import { FolderSimpleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { createFileRoute } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { AgentPrompt } from '~/components/agent-prompt';
import { TaskGroup, TaskList } from '~/components/agent/task-list';
import { Backdrop } from '~/components/backdrop/backdrop';
import shader from '~/components/backdrop/prompt.wgsl';
import { useField } from '~/components/backdrop/use-field';
import { Account } from '~/components/shell/account';
import { Brand } from '~/components/shell/brand';
import { Nav } from '~/components/shell/nav';
import { ThreadRow } from '~/components/shell/thread-row';
import { Button } from '~/components/ui/button';
import { Separator } from '~/components/ui/separator';
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
    label: 'read',
    status: 'done' as const,
    resources: [{ name: 'packages/sync/src/index.ts', kind: 'file' as const }],
  },
  {
    id: '2',
    label: 'grep',
    status: 'done' as const,
    resources: [{ name: 'apps/web/src/components/shell', kind: 'dir' as const }],
    detail:
      'apps/web/src/components/shell/threads.tsx:58\napps/web/src/components/shell/sidebar.tsx:37',
  },
  {
    id: '3',
    label: 'bash',
    status: 'running' as const,
    resources: [{ name: 'bun run check-types', kind: 'command' as const }],
  },
  { id: '4', label: 'edit', status: 'pending' as const },
] as const;

function Preview() {
  const params = Route.useSearch();
  const field = useField({ quiet: [0, 0, 0, 0] });
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = box.current;
    const stage = host.current;
    if (!node || !stage) return;

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

  let seq = 0;

  return (
    <div className="grid h-svh grid-cols-[15.5rem_minmax(0,1fr)] overflow-hidden bg-background p-2 text-foreground">
      <>
        <aside className="h-full min-h-0 pr-2">
          <div className="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-2">
            <header className="flex h-9 items-center">
              <Brand />
            </header>

            <Nav />

            <section className="grid min-h-0 grid-rows-[auto_1fr] gap-1">
              <header className="flex h-8 items-center justify-between gap-2 px-2.5">
                <h2 className="truncate text-sm text-muted-foreground">Threads</h2>
                <Button className="size-6 text-muted-foreground" size="icon-sm" variant="ghost">
                  <MagnifyingGlassIcon />
                </Button>
              </header>

              <div className="min-h-0 overflow-y-auto pr-1 pb-8 [mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]">
                <div className="grid gap-3">
                  {GROUPS.map((entry) => (
                    <section key={entry.label}>
                      <div className="mb-0.5 flex items-center gap-1.5 px-2.5">
                        <FolderSimpleIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-muted-foreground/70"
                        />
                        <h3 className="min-w-0 truncate text-xs text-muted-foreground">
                          {entry.label}
                        </h3>
                        <span className="text-xs tabular-nums text-muted-foreground/60">
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

            <footer className="grid gap-1.5">
              <Separator />
              <Account ready threads={7} user={USER} onSignout={() => undefined} />
            </footer>
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden rounded-(--radius-shell) border border-border bg-surface-2 shadow-surface-2">
          <div
            ref={host}
            className={cn(
              'relative h-full min-h-0 overflow-hidden px-4',
              params.v === 'tasks'
                ? 'grid grid-rows-[1fr_auto]'
                : 'grid grid-rows-[1fr_auto_0.62fr]',
            )}
          >
            <Backdrop shader={shader} state={field.state} />

            {params.v === 'tasks' ? (
              <div className="relative z-10 min-h-0 overflow-y-auto py-8">
                <div className="mx-auto w-full max-w-3xl">
                  <TaskGroup>
                    <TaskList revealed={TASKS.length} tasks={TASKS} />
                  </TaskGroup>
                </div>
              </div>
            ) : null}

            <div
              ref={box}
              className={cn(
                'relative z-10 w-full max-w-3xl pb-3',
                params.v !== 'tasks' && 'row-start-2 justify-self-center',
              )}
            >
              {params.v === 'tasks' ? null : (
                <h1 className="mx-auto mb-5 max-w-lg text-center text-[26px] leading-[1.2] tracking-[-0.025em] text-balance">
                  <Swap value="What are we working on?" />
                </h1>
              )}

              <AgentPrompt
                className="rounded-(--radius-shell) border-0 bg-transparent px-0 pt-0 pb-0 backdrop-blur-none"
                error={null}
                pristine
                value={draft}
                onSubmit={() => setDraft('')}
                onValue={(value) => {
                  setDraft(value);
                  field.beat();
                }}
              />
            </div>
          </div>
        </main>
      </>
    </div>
  );
}
