import { useLiveQuery } from '@tanstack/react-db';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import type { ShellUser } from '~/components/shell/model';

import { ThreadComposer } from '~/components/shell/thread-composer';
import { ThreadItem } from '~/components/shell/thread-item';
import { list, roster } from '~/utils/chat';

function ChatSidebar(props: { user: ShellUser }) {
  const nav = useNavigate();
  const params = useParams({ strict: false });
  const owner = props.user.id;
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
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_1fr] gap-3">
      <header className="px-1">
        <p className="text-sm font-semibold text-foreground">Chat</p>
        <p className="text-[11px] text-muted-foreground">
          {threads.length ? `${threads.length} synced conversations` : 'No conversations yet'}
        </p>
      </header>
      <ThreadComposer
        debug={debug}
        disabled={threads.length < 2}
        title={title}
        onCycle={cycle}
        onCreate={create}
        onTitle={setTitle}
      />
      <div className="min-h-0 overflow-y-auto pr-1 scrollbar-gutter-both">
        {threads.length ? (
          <div className="grid gap-1">
            {threads.map((row) => (
              <ThreadItem
                active={row.id === active}
                id={row.id}
                key={row.id}
                title={row.title}
                updated={row.updatedAt}
                onArchive={archive}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 p-3 text-xs text-muted-foreground">
            Create a conversation to test realtime sync.
          </p>
        )}
      </div>
    </div>
  );
}

export { ChatSidebar };
