import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client';
import { createFileRoute } from '@tanstack/react-router';

import { auth } from '@canary/auth';
import { env } from '@canary/env/server';

const pass = new Set(ELECTRIC_PROTOCOL_QUERY_PARAMS);

type Shape = {
  columns: string[];
  params: string[];
  table: string;
  where: string;
};

function shape(name: string, url: URL, uid: string): Shape | null {
  if (name === 'threads') {
    return {
      table: 'thread',
      where: 'owner_id = $1 and archived_at is null',
      params: [uid],
      columns: ['id', 'owner_id', 'title', 'created_at', 'updated_at', 'archived_at'],
    };
  }

  const tid = url.searchParams.get('threadId');

  if (!tid) {
    return null;
  }

  if (name === 'messages') {
    return {
      table: 'message',
      where: 'owner_id = $1 and thread_id = $2',
      params: [uid, tid],
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
      where: 'owner_id = $1 and thread_id = $2',
      params: [uid, tid],
      columns: [
        'id',
        'thread_id',
        'owner_id',
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

  if (name === 'events') {
    return {
      table: 'run_event',
      where: 'owner_id = $1 and thread_id = $2',
      params: [uid, tid],
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
  const spec = shape(params.shape, src, session.user.id);

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

  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set(
    'Access-Control-Expose-Headers',
    'electric-offset, electric-handle, electric-schema, electric-cursor',
  );

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export const Route = createFileRoute('/api/sync/$shape')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
