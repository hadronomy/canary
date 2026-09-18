import { FolderSimpleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { createFileRoute } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
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
import { Elevated } from '~/lib/elevated';
import { Swap } from '~/lib/motion';

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
      ['Rewrite the sync keepalive proxy', 3],
      ['Why does the composer drop focus on send?', 18],
      ['Draft the varlock migration notes', 64],
      ['Electric shape ownership', 190],
    ] as const,
  },
  {
    label: 'Recent',
    rows: [
      ['Token exchange RFC 8693 plan', 1500],
      ['Rust rate limiting with tower_governor', 2600],
      ['Effect v4 migration sweep', 4300],
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
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;

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

  let seq = 0;

  return (
    <div className="canary-shell h-svh overflow-hidden p-3 text-foreground">
      <div className="flex h-full min-h-0 gap-(--shell-gap)">
        <Elevated
          shadowLevel={2}
          className="h-full min-h-0 w-[16.5rem] shrink-0 overflow-hidden rounded-(--radius-shell) border border-sidebar-border p-2 text-sidebar-foreground"
        >
          <div className="grid h-full min-h-0 grid-rows-[auto_auto_1fr_auto] gap-2">
            <header className="flex items-center justify-between gap-2">
              <Brand />
              <Button className="size-8 text-muted-foreground" size="icon" variant="ghost">
                <MagnifyingGlassIcon />
              </Button>
            </header>

            <Nav />

            <section className="grid min-h-0 grid-rows-[auto_1fr] gap-1">
              <header className="flex h-7 items-center justify-between gap-2 px-2">
                <h2 className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Threads
                </h2>
                <Button className="size-6 text-muted-foreground" size="icon-sm" variant="ghost">
                  <MagnifyingGlassIcon />
                </Button>
              </header>

              <div className="min-h-0 overflow-y-auto pr-1">
                <div className="grid gap-3">
                  {GROUPS.map((entry) => (
                    <section key={entry.label}>
                      <div className="mb-1 flex items-center gap-1.5 px-2">
                        <FolderSimpleIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-muted-foreground/70"
                        />
                        <h3 className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
                          {entry.label}
                        </h3>
                        <span className="text-[11px] tabular-nums text-muted-foreground/60">
                          {entry.rows.length}
                        </span>
                      </div>

                      <div className="grid gap-px">
                        {entry.rows.map(([title, minutes], index) => (
                          <ThreadRow
                            active={seq++ === 1}
                            id={`preview-${title.length}-${minutes}`}
                            index={index}
                            key={title}
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

            <footer className="grid gap-1">
              <Separator />
              <Account ready threads={7} user={USER} onSignout={() => undefined} />
            </footer>
          </div>
        </Elevated>

        <main className="canary-panel min-h-0 flex-1 overflow-hidden rounded-(--radius-shell)">
          <div className="relative grid h-full min-h-0 grid-rows-[1fr_auto] overflow-hidden bg-surface-1">
            <Backdrop shader={shader} state={field.state} />

            {params.v === 'tasks' ? (
              <div className="relative z-10 min-h-0 overflow-y-auto px-6 py-8">
                <div className="mx-auto w-full max-w-3xl">
                  <TaskGroup>
                    <TaskList revealed={TASKS.length} tasks={TASKS} />
                  </TaskGroup>
                </div>
              </div>
            ) : (
              <div className="relative z-10 grid min-h-0 place-items-end justify-items-center px-6 pb-4">
                <h1 className="max-w-lg text-center text-[22px] leading-[1.25] tracking-[-0.02em] text-balance">
                  <Swap value="What are we working on?" />
                </h1>
              </div>
            )}

            <div ref={box} className="relative z-10 px-3 pb-3">
              <AgentPrompt
                className="mx-auto max-w-3xl rounded-(--radius-shell) border-0 bg-transparent px-0 pt-0 backdrop-blur-none"
                error={null}
                pristine
                value=""
                onSubmit={() => undefined}
                onValue={() => field.beat()}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
