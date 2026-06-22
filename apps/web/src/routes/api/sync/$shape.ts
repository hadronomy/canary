import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client';
import { createFileRoute } from '@tanstack/react-router';

import { auth } from '@canary/auth';
import { env } from '@canary/env/server';

const pass = new Set(ELECTRIC_PROTOCOL_QUERY_PARAMS);
const ping = new TextEncoder().encode(': keep-alive\n\n');
const utf8 = new TextDecoder();

type Shape = {
  columns: string[];
  params: string[];
  table: string;
  where: string;
};

function shape(name: string, uid: string): Shape | null {
  if (name === 'threads') {
    return {
      table: 'thread',
      where: 'owner_id = $1 and archived_at is null',
      params: [uid],
      columns: ['id', 'owner_id', 'title', 'created_at', 'updated_at', 'archived_at'],
    };
  }

  if (name === 'messages') {
    return {
      table: 'message',
      where: 'owner_id = $1',
      params: [uid],
      columns: [
        'id',
        'thread_id',
        'owner_id',
        'run_id',
        'role',
        'content',
        'metadata',
        'created_at',
        'updated_at',
      ],
    };
  }

  if (name === 'runs') {
    return {
      table: 'run',
      where: 'owner_id = $1',
      params: [uid],
      columns: [
        'id',
        'thread_id',
        'owner_id',
        'input_message_id',
        'status',
        'model',
        'error',
        'started_at',
        'completed_at',
        'created_at',
        'updated_at',
      ],
    };
  }

  if (name === 'parts') {
    return {
      table: 'message_part',
      where: 'owner_id = $1',
      params: [uid],
      columns: [
        'id',
        'message_id',
        'run_id',
        'thread_id',
        'owner_id',
        'seq',
        'kind',
        'status',
        'tool_name',
        'content',
        'data',
        'created_at',
        'updated_at',
      ],
    };
  }

  if (name === 'events') {
    return {
      table: 'run_event',
      where: 'owner_id = $1',
      params: [uid],
      columns: ['id', 'run_id', 'thread_id', 'owner_id', 'seq', 'type', 'data', 'created_at'],
    };
  }

  return null;
}

async function handle({ params, request }: { params: { shape: string }; request: Request }) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const src = new URL(request.url);
  const spec = shape(params.shape, session.user.id);

  if (!spec) {
    return new Response('Shape not found', { status: 404 });
  }

  const dst = new URL('/v1/shape', env.ELECTRIC_URL);

  src.searchParams.forEach((value, key) => {
    if (pass.has(key)) {
      dst.searchParams.set(key, value);
    }
  });

  dst.searchParams.set('table', spec.table);
  dst.searchParams.set('where', spec.where);
  dst.searchParams.set('columns', spec.columns.join(','));
  spec.params.forEach((value, index) => {
    dst.searchParams.set(`params[${index + 1}]`, value);
  });

  if (env.ELECTRIC_SECRET) {
    dst.searchParams.set('secret', env.ELECTRIC_SECRET);
  }

  const res = await fetch(dst, {
    method: request.method,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  });
  const headers = new Headers(res.headers);
  const sse = headers.get('content-type')?.includes('text/event-stream') ?? false;

  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set(
    'Access-Control-Expose-Headers',
    'electric-offset, electric-handle, electric-schema, electric-cursor',
  );
  if (sse) {
    headers.set('X-Accel-Buffering', 'no');
  }

  return new Response(sse ? live(res.body) : res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function live(body: ReadableStream<Uint8Array> | null) {
  if (!body) {
    return body;
  }

  const reader = body.getReader();
  let tick: ReturnType<typeof setInterval> | undefined;
  let ready = true;
  const stop = () => {
    if (tick) {
      clearInterval(tick);
    }
    tick = undefined;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      tick = setInterval(() => {
        if (ready) {
          controller.enqueue(ping);
        }
      }, 5_000);
      pipe(
        reader,
        controller,
        (state) => {
          ready = state;
        },
        stop,
      ).catch((err: unknown) => {
        stop();
        controller.error(err);
      });
    },
    cancel(reason) {
      stop();
      return reader.cancel(reason);
    },
  });
}

async function pipe(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  set: (ready: boolean) => void,
  stop: () => void,
  prev = '',
) {
  const chunk = await reader.read();

  if (chunk.done) {
    stop();
    controller.close();
    return;
  }

  controller.enqueue(chunk.value);
  const tail = edge(prev, chunk.value);
  set(done(tail));
  await pipe(reader, controller, set, stop, tail);
}

function edge(prev: string, value: Uint8Array) {
  return `${prev}${utf8.decode(value.slice(-4))}`.slice(-4);
}

function done(text: string) {
  return text.endsWith('\n\n') || text.endsWith('\r\n\r\n');
}

export const Route = createFileRoute('/api/sync/$shape')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
