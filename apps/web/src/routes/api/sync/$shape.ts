import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client';
import { createFileRoute } from '@tanstack/react-router';

import { auth } from '@canary/auth';
import { ENV } from '~/env';

const pass = new Set(ELECTRIC_PROTOCOL_QUERY_PARAMS);

async function handle({ params, request }: { params: { shape: string }; request: Request }) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const src = new URL(request.url);
  const { Replica } = await import('@canary/db/replica');

  if (!Replica.has(params.shape)) {
    return new Response('Shape not found', { status: 404 });
  }

  const replica = Replica.get(params.shape);
  const dst = new URL('/v1/shape', ENV.ELECTRIC_URL);

  src.searchParams.forEach((value, key) => {
    if (pass.has(key)) {
      dst.searchParams.set(key, value);
    }
  });

  dst.searchParams.set('table', replica.table);
  dst.searchParams.set('where', replica.where);
  dst.searchParams.set('columns', replica.columns.join(','));
  dst.searchParams.set('params[1]', session.user.id);

  if (ENV.ELECTRIC_SECRET) {
    dst.searchParams.set('secret', ENV.ELECTRIC_SECRET);
  }

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body;
  const type = request.headers.get('content-type');
  const res = await fetch(dst, {
    method: request.method,
    body,
    headers: type ? { 'content-type': type } : undefined,
    signal: request.signal,
    ...(body ? { duplex: 'half' as const } : {}),
  });
  const headers = new Headers(res.headers);
  const sse = headers.get('content-type')?.includes('text/event-stream') ?? false;

  if (res.status === 409) {
    console.warn(`Electric shape ${params.shape}: 409 handle expired; client must resync`);
  } else if (!res.ok && res.status !== 304) {
    console.warn(`Electric shape ${params.shape}: upstream returned ${res.status}`);
  }
  if (res.status === 200 && !headers.has('electric-handle')) {
    console.warn(`Electric shape ${params.shape}: 200 response has no electric-handle`);
  }

  headers.delete('content-encoding');
  headers.delete('content-length');
  if (
    !headers
      .get('vary')
      ?.split(',')
      .some((value) => value.trim().toLowerCase() === 'cookie')
  ) {
    headers.append('Vary', 'Cookie');
  }
  if (sse) {
    headers.set('X-Accel-Buffering', 'no');
  }

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
