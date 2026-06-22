import { useLiveQuery } from '@tanstack/react-db';
import { useHotkey } from '@tanstack/react-hotkeys';
import { Link, Outlet, createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { ArchiveIcon, CycleIcon, PlusIcon } from '~/components/icons';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';
import { list, roster, setup } from '~/utils/chat';

export const Route = createFileRoute('/_auth/threads')({
  ssr: false,
  beforeLoad: async () => {
    await setup();
  },
  loader: async ({ context }) => {
    await roster(context.user.id).preload();
    return null;
  },
  component: ThreadsComponent,
});

function ThreadsComponent() {
  const ctx = Route.useRouteContext();
  const nav = useNavigate();
  const params = useParams({ strict: false });
  const owner = ctx.user.id;
  const active = typeof params.threadId === 'string' ? params.threadId : null;
  const col = list(owner);
  const frame = useRef<number | null>(null);
  const [title, setTitle] = useState('');
  const [debug, setDebug] = useState(false);
  const threads = useLiveQuery(roster(owner)).data;

  useEffect(() => {
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, []);

  useHotkey('Alt+ArrowUp', () => jump(-1), {
    ignoreInputs: false,
    preventDefault: true,
  });
  useHotkey('Alt+ArrowDown', () => jump(1), {
    ignoreInputs: false,
    preventDefault: true,
  });

  function jump(dir: number) {
    if (!threads.length) {
      return;
    }

    const index = active ? threads.findIndex((row) => row.id === active) : -1;
    const base = index >= 0 ? index : dir > 0 ? -1 : 0;
    const row = threads.at((base + dir + threads.length) % threads.length);

    if (!row || row.id === active) {
      return;
    }

    nav({
      to: '/threads/$threadId',
      params: {
        threadId: row.id,
      },
    }).catch((err: unknown) => {
      console.error('Thread hotkey navigation failed.', err);
    });
  }

  function cycle() {
    if (debug || threads.length < 2) {
      return;
    }

    const ids = threads.map((row) => row.id);
    const index = active ? ids.indexOf(active) : -1;
    const start = index >= 0 ? index : 0;
    const total = ids.length * 3;
    let step = 0;

    setDebug(true);

    function next() {
      step += 1;
      const id = ids[(start + step) % ids.length];

      if (!id) {
        frame.current = null;
        setDebug(false);
        return;
      }

      nav({
        to: '/threads/$threadId',
        params: {
          threadId: id,
        },
        replace: true,
      }).catch((err: unknown) => {
        console.error('Thread debug navigation failed.', err);
      });

      if (step >= total) {
        frame.current = null;
        setDebug(false);
        return;
      }

      frame.current = requestAnimationFrame(next);
    }

    frame.current = requestAnimationFrame(next);
  }

  function create() {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = title.trim() || 'New thread';

    const tx = col.insert({
      id,
      ownerId: owner,
      title: name,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    setTitle('');
    nav({
      to: '/threads/$threadId',
      params: {
        threadId: id,
      },
    })
      .then(() => tx.isPersisted.promise)
      .catch((err: unknown) => {
        console.error('Thread create failed.', err);
      });
  }

  function archive(id: string) {
    col.update(id, (draft) => {
      draft.archivedAt = new Date().toISOString();
    });
  }

  return (
    <main className="grid min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[1fr_280px]">
      <section className="min-h-0">
        <Outlet />
      </section>
      <aside className="grid min-h-0 grid-rows-[auto_1fr] border-l">
        <form
          className="grid grid-cols-[1fr_auto_auto] gap-2 border-b p-2"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <Input
            value={title}
            placeholder="New thread"
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <Button aria-label="Create thread" size="icon" type="submit">
            <PlusIcon />
          </Button>
          <Button
            aria-label="Debug cycle threads"
            disabled={debug || threads.length < 2}
            size="icon"
            type="button"
            variant="secondary"
            onClick={cycle}
          >
            <CycleIcon />
          </Button>
        </form>
        <div className="min-h-0 overflow-y-auto p-2">
          {threads.length ? (
            <div className="flex flex-col gap-1">
              {threads.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    'grid grid-cols-[1fr_auto] items-center border text-xs hover:bg-muted',
                    row.id === active && 'bg-muted',
                  )}
                >
                  <Link
                    className="min-w-0 px-2 py-2"
                    params={{ threadId: row.id }}
                    preload={false}
                    to="/threads/$threadId"
                  >
                    <span className="block truncate">{row.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {new Date(row.updatedAt).toLocaleTimeString()}
                    </span>
                  </Link>
                  <Button
                    aria-label={`Archive ${row.title}`}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                    onClick={() => archive(row.id)}
                  >
                    <ArchiveIcon />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-2 text-xs text-muted-foreground">
              Create a thread to start testing sync.
            </p>
          )}
        </div>
      </aside>
    </main>
  );
}
