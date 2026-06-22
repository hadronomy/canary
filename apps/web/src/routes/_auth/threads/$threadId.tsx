import { code } from '@streamdown/code';
import { useLiveQuery } from '@tanstack/react-db';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useVirtualizer, type ReactVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Streamdown } from 'streamdown';

import type { Message, Part } from '@canary/sync';

import { AgentIcon, LatestIcon, SendIcon } from '~/components/icons';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { active, messages, pieces, roster, transcript } from '~/utils/chat';

type Item =
  | { id: string; kind: 'assistant'; live?: boolean; msg?: Message; part?: Part; text: string }
  | { id: string; kind: 'empty' }
  | { id: string; kind: 'reasoning'; live?: boolean; part: Part }
  | { id: string; kind: 'tool'; part: Part }
  | { id: string; kind: 'user'; msg: Message };
type Block = { at: string; id: string; items: Item[]; rank: number };
type Snap = { kind: 'end' } | { kind: 'offset'; top: number };
type Scroll = {
  el: HTMLDivElement | null;
  id: string;
  loaded: boolean;
  pin: React.RefObject<boolean>;
  ready: boolean;
  rest: React.RefObject<boolean>;
  setEl: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setPin: React.Dispatch<React.SetStateAction<boolean>>;
  virt: ReactVirtualizer<HTMLDivElement, HTMLDivElement>;
};

export const Route = createFileRoute('/_auth/threads/$threadId')({
  ssr: false,
  loader: async ({ context, params }) => {
    await Promise.all([
      roster(context.user.id).preload(),
      transcript(context.user.id, params.threadId).preload(),
      pieces(context.user.id, params.threadId).preload(),
      active(context.user.id, params.threadId).preload(),
    ]);
    return null;
  },
  component: ThreadComponent,
});

function ThreadComponent() {
  const ctx = Route.useRouteContext();
  const params = Route.useParams();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const owner = ctx.user.id;
  const query = useLiveQuery(roster(owner));
  const thread = query.data.find((row) => row.id === params.threadId);
  const gone = query.isReady && !thread;

  useEffect(() => {
    if (!gone) {
      return;
    }

    nav({ to: '/threads', replace: true }).catch((err: unknown) => {
      console.error('Thread redirect failed.', err);
    });
  }, [gone, nav]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send().catch((err: unknown) => {
      console.error('Message send failed.', err);
    });
  }

  async function send() {
    if (!thread || !text.trim()) {
      return;
    }

    const body = text.trim();
    const now = new Date().toISOString();
    const tx = messages(owner).insert({
      id: crypto.randomUUID(),
      threadId: params.threadId,
      ownerId: owner,
      runId: null,
      role: 'user',
      content: body,
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });

    setText('');
    setErr(null);
    await tx.isPersisted.promise.catch((cause: unknown) => {
      setText((prev) => prev || body);
      setErr(cause instanceof Error ? cause.message : 'Message send failed.');
      throw cause;
    });
  }

  if (gone) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        This thread was archived or is no longer available.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto]">
      <header className="border-b px-3 py-2">
        <h1 className="truncate text-sm font-medium">{thread?.title ?? 'Thread'}</h1>
        <p className="text-xs text-muted-foreground">{params.threadId}</p>
      </header>
      <Transcript id={params.threadId} ownerId={owner} />
      <form className="flex gap-2 border-t p-2" onSubmit={submit}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Input
            value={text}
            placeholder="Ask the agent..."
            onChange={(event) => setText(event.currentTarget.value)}
          />
          {err ? <p className="text-xs text-destructive">{err}</p> : null}
        </div>
        <Button disabled={!text.trim()} type="submit">
          <SendIcon />
          Send
        </Button>
      </form>
    </div>
  );
}

function Transcript(props: { id: string; ownerId: string }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const rest = useRef(true);
  const [pin, setPin] = useState(true);
  const jump = useRef(false);
  const [jumping, setJumping] = useState(false);
  const query = useLiveQuery(transcript(props.ownerId, props.id));
  const partQuery = useLiveQuery(pieces(props.ownerId, props.id));
  const runQuery = useLiveQuery(active(props.ownerId, props.id));
  const ready = query.isReady && partQuery.isReady;
  const running = runQuery.data.length > 0;
  const items = useMemo(
    () => materialize(query.data, partQuery.data),
    [partQuery.data, query.data],
  );
  const loaded = query.data.length > 0 || partQuery.data.some(show);
  const mark = useCallback((next: boolean) => {
    jump.current = next;
    setJumping(next);
  }, []);
  const virt = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => el,
    getItemKey: (index) => items[index]?.id ?? index,
    estimateSize: (index) => estimate(items[index]) + gap(items[index], items[index - 1]),
    overscan: 18,
    gap: 0,
    enabled: !!el,
    initialOffset: () => {
      return Number.MAX_SAFE_INTEGER;
    },
    anchorTo: 'end',
    followOnAppend: 'auto',
    scrollEndThreshold: 96,
    useFlushSync: false,
    onChange: (inst, sync) => {
      const next = inst.isAtEnd();

      if (next && jump.current) {
        mark(false);
      }

      if (rest.current) {
        return;
      }

      if (!sync && pinned.current) {
        return;
      }

      pinned.current = next;
      setPin((prev) => (prev === next ? prev : next));
    },
  });
  const scroll = useThreadScrollRestoration({
    el,
    id: props.id,
    loaded,
    pin: pinned,
    ready,
    rest,
    setEl,
    setPin,
    virt,
  });
  const list = virt.getVirtualItems();
  const latest = useCallback(() => {
    flushSync(() => {
      pinned.current = true;
      setPin(true);
      mark(true);
    });

    scroll.latest('smooth');
  }, [mark, scroll]);
  const showJump = !pin && !jumping;

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const seen = new Set<string>();
    items.forEach((item) => {
      if (seen.has(item.id)) {
        console.warn('Duplicate virtual item id:', item.id, item);
      }

      seen.add(item.id);
    });
  }, [items]);

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scroll.ref}
        className="h-full min-h-0 overflow-y-scroll px-3 pb-24 pt-3 [overflow-anchor:none] scrollbar-gutter-both"
      >
        <div className="mx-auto max-w-3xl">
          <div className="relative w-full" style={{ height: `${virt.getTotalSize()}px` }}>
            {list.map((row) => {
              const item = items[row.index];

              if (!item) {
                return null;
              }
              const prev = items[row.index - 1];

              return (
                <div
                  key={String(row.key)}
                  ref={virt.measureElement}
                  className="absolute left-0 top-0 flow-root w-full min-w-0"
                  data-index={row.index}
                  style={{
                    paddingTop: `${gap(item, prev)}px`,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <Row item={item} ready={ready} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <TranscriptHud running={running} showJump={showJump} onJump={latest} />
    </div>
  );
}

function Row(props: { item: Item; ready: boolean }) {
  if (props.item.kind === 'user') {
    return <User msg={props.item.msg} />;
  }

  if (props.item.kind === 'assistant') {
    return <Assistant live={props.item.live} text={props.item.text} />;
  }

  if (props.item.kind === 'reasoning') {
    return <Reasoning live={props.item.live} part={props.item.part} />;
  }

  if (props.item.kind === 'tool') {
    return <Tool part={props.item.part} />;
  }

  return props.ready ? (
    <p className="text-sm text-muted-foreground">Send the first message.</p>
  ) : (
    <div className="min-h-20" />
  );
}

function estimate(item: Item | undefined) {
  if (!item) {
    return 120;
  }

  if (item.kind === 'user') {
    return 84;
  }

  if (item.kind === 'assistant') {
    return Math.max(72, Math.min(520, 48 + item.text.length * 0.35));
  }

  if (item.kind === 'reasoning') {
    return 120;
  }

  if (item.kind === 'tool') {
    return 180;
  }

  return 80;
}

function gap(item: Item | undefined, prev: Item | undefined) {
  if (!item || !prev) {
    return 0;
  }

  if (item.kind === 'user' && prev.kind === 'user') {
    return 12;
  }

  if (item.kind === 'user' || prev.kind === 'user') {
    return 32;
  }

  return 12;
}

function useThreadScrollRestoration(opts: Scroll) {
  const box = useRef<HTMLDivElement | null>(null);
  const boot = useRef<string | null>(null);
  const cur = useRef(opts.id);
  const snaps = useRef(new Map<string, Snap>());
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node && box.current) {
        snaps.current.set(cur.current, capture(box.current, opts.pin.current));
      }

      box.current = node;
      opts.setEl(node);

      if (node) {
        restore(node, snaps.current.get(cur.current));
      }
    },
    [opts.pin, opts.setEl],
  );
  const latest = useCallback(
    (behavior: ScrollBehavior) => {
      snaps.current.set(opts.id, { kind: 'end' });
      opts.pin.current = true;
      opts.setPin(true);
      opts.virt.scrollToEnd({ behavior });
    },
    [opts.id, opts.pin, opts.setPin, opts.virt],
  );

  useLayoutEffect(() => {
    const prev = cur.current;

    if (prev === opts.id) {
      return;
    }

    if (box.current) {
      snaps.current.set(prev, capture(box.current, opts.pin.current));
    }

    const snap = snaps.current.get(opts.id);
    const next = !snap || snap.kind === 'end';

    cur.current = opts.id;
    boot.current = null;
    opts.rest.current = true;
    opts.pin.current = next;
    opts.setPin(next);

    if (box.current) {
      restore(box.current, snap);
    }
  }, [opts.id, opts.pin, opts.rest, opts.setPin]);

  useLayoutEffect(() => {
    if (!opts.ready || !opts.el || boot.current === opts.id) {
      return;
    }

    const snap = snaps.current.get(opts.id);

    if (!opts.loaded) {
      opts.rest.current = false;
      return;
    }

    if (snap?.kind === 'offset') {
      opts.el.scrollTop = snap.top;
      boot.current = opts.id;
      opts.rest.current = false;
      return;
    }

    opts.pin.current = true;
    opts.setPin(true);
    opts.el.scrollTop = Number.MAX_SAFE_INTEGER;
    opts.virt.scrollToEnd({ behavior: 'auto' });
    boot.current = opts.id;

    const frame = requestAnimationFrame(() => {
      opts.virt.scrollToEnd({ behavior: 'auto' });
      opts.rest.current = false;
    });

    return () => {
      cancelAnimationFrame(frame);
      opts.rest.current = false;
    };
  }, [opts.el, opts.id, opts.loaded, opts.pin, opts.ready, opts.rest, opts.setPin, opts.virt]);

  return { latest, ref };
}

function end(el: HTMLDivElement, gap = 96) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= gap;
}

function capture(el: HTMLDivElement, pin: boolean): Snap {
  if (pin || end(el)) {
    return { kind: 'end' };
  }

  return { kind: 'offset', top: el.scrollTop };
}

function restore(el: HTMLDivElement, snap: Snap | undefined) {
  if (snap?.kind === 'offset') {
    el.scrollTop = snap.top;
    return;
  }

  el.scrollTop = Number.MAX_SAFE_INTEGER;
}

function materialize(msgs: Message[], parts: Part[]): Item[] {
  const groups = group(parts);
  const done = new Set(msgs.flatMap((msg) => (msg.runId ? [msg.runId] : [])));
  const blocks = [
    ...chrono(msgs).map((msg) => {
      const rows = order(groups.get(msg.id) ?? []);

      return {
        id: `msg:${msg.id}`,
        at: rows[0]?.createdAt ?? msg.createdAt,
        rank: msg.role === 'user' ? 0 : 1,
        items: turn(msg, rows),
      };
    }),
    ...[...live(parts, done)].map(([id, parts]) => {
      const rows = order(parts);

      return {
        id: `run:${id}`,
        at: rows[0]?.createdAt ?? '',
        rank: 1,
        items: rows.map((part) => partItem(part, true)),
      };
    }),
  ] satisfies Block[];
  const rows = blocks
    .filter((block) => block.items.length)
    .toSorted((a, b) => a.at.localeCompare(b.at) || a.rank - b.rank || a.id.localeCompare(b.id))
    .flatMap((block) => block.items);
  return rows.length ? rows : [{ id: 'state:empty', kind: 'empty' as const }];
}

function turn(msg: Message, parts: Part[]): Item[] {
  if (msg.role === 'user') {
    return [{ id: msg.id, kind: 'user', msg }];
  }

  const rows = order(parts)
    .filter((part) => show(part))
    .map((part) => partItem(part, false));

  if (rows.length) {
    return rows;
  }

  return [
    {
      id: msg.id,
      kind: 'assistant',
      msg,
      text: msg.content,
    },
  ];
}

function partItem(part: Part, live: boolean): Item {
  if (part.kind === 'text') {
    return {
      id: part.id,
      kind: 'assistant',
      live: live || part.status === 'running',
      part,
      text: part.content,
    };
  }

  if (part.kind === 'reasoning') {
    return {
      id: part.id,
      kind: 'reasoning',
      live: live || part.status === 'running',
      part,
    };
  }

  return {
    id: part.id,
    kind: 'tool',
    part,
  };
}

function User(props: { msg: Message }) {
  return (
    <Card className="ml-auto w-fit max-w-[min(58%,36rem)] rounded-sm py-2" size="sm">
      <CardContent className="px-3">
        <p className="whitespace-pre-wrap text-sm leading-6 wrap-anywhere">{props.msg.content}</p>
      </CardContent>
    </Card>
  );
}

function Assistant(props: { live?: boolean; text: string }) {
  return (
    <div className="flow-root min-w-0 max-w-full">
      <Markdown live={props.live} text={props.text} />
    </div>
  );
}

function Reasoning(props: { live?: boolean; part: Part }) {
  return (
    <details className="flow-root min-w-0 max-w-full rounded-sm border bg-muted/20 p-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground">Reasoning</summary>
      <Markdown live={props.live || props.part.status === 'running'} text={props.part.content} />
    </details>
  );
}

function Tool(props: { part: Part }) {
  const body =
    props.part.content.trim() || (props.part.data ? JSON.stringify(props.part.data, null, 2) : '');

  return (
    <details
      className="my-2 flow-root min-w-0 max-w-full rounded-sm border bg-muted/30 text-xs"
      open={props.part.status === 'running' ? true : undefined}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <span className="min-w-0 truncate font-mono text-[11px]">
          {props.part.toolName ?? 'tool call'}
        </span>
        <span className="shrink-0 text-muted-foreground">{props.part.status}</span>
      </summary>
      {body ? (
        <pre className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap border-t px-3 py-2 leading-5 wrap-anywhere">
          {body}
        </pre>
      ) : null}
    </details>
  );
}

function TranscriptHud(props: { onJump: () => void; running: boolean; showJump: boolean }) {
  if (!props.running && !props.showJump) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 px-3">
      <div className="mx-auto grid max-w-3xl grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div className="justify-self-start">
          {props.running ? (
            <div className="rounded-full border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
              <Work />
            </div>
          ) : null}
        </div>
        <div className="justify-self-center">
          {props.showJump ? (
            <Button
              aria-label="Jump to latest"
              className="pointer-events-auto shadow-lg"
              size="icon"
              title="Jump to latest"
              type="button"
              onClick={props.onJump}
            >
              <LatestIcon />
            </Button>
          ) : null}
        </div>
        <div />
      </div>
    </div>
  );
}

const Markdown = memo(function Markdown(props: { live?: boolean; text: string }) {
  return (
    <Streamdown
      className="canary-markdown"
      mode={props.live ? 'streaming' : 'static'}
      plugins={{ code }}
    >
      {props.text}
    </Streamdown>
  );
});

function group(rows: Part[]) {
  return rows
    .filter((row) => row.messageId)
    .reduce((map, row) => {
      const id = row.messageId;

      if (!id) {
        return map;
      }

      map.set(id, [...(map.get(id) ?? []), row]);
      return map;
    }, new Map<string, Part[]>());
}

function live(rows: Part[], done: Set<string>) {
  return order(rows)
    .filter((row) => !row.messageId && !done.has(row.runId) && show(row))
    .reduce((map, row) => {
      map.set(row.runId, [...(map.get(row.runId) ?? []), row]);
      return map;
    }, new Map<string, Part[]>());
}

function chrono(rows: Message[]) {
  return rows.toSorted(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function order(rows: Part[]) {
  return rows.toSorted(
    (a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function show(part: Part) {
  if (part.kind === 'text' || part.kind === 'reasoning') {
    return part.status === 'running' || !!part.content.trim();
  }

  return true;
}

function Work() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <AgentIcon className="size-4 animate-pulse" />
      Agent is working...
    </div>
  );
}
