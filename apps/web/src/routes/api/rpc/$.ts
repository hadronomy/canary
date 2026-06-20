import { createContext } from '@canary/api/context';
import { appRouter } from '@canary/api/routers/index';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { createFileRoute } from '@tanstack/react-router';

const rpc = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

const openapi = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

async function handle({ request }: { request: Request }) {
  const ctx = await createContext({ req: request });
  const a = await rpc.handle(request, {
    prefix: '/api/rpc',
    context: ctx,
  });

  if (a.response) {
    return a.response;
  }

  const b = await openapi.handle(request, {
    prefix: '/api/rpc/api-reference',
    context: ctx,
  });

  if (b.response) {
    return b.response;
  }

  return new Response('Not found', { status: 404 });
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
