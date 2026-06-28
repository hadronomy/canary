import { LightningIcon } from '@phosphor-icons/react';
import { createFileRoute } from '@tanstack/react-router';

import { shellRoutes } from '~/components/shell/routes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

export const Route = createFileRoute('/_auth/')({
  loader: async ({ context }) => {
    return await context.queryClient.ensureQueryData(context.orpc.health.check.queryOptions());
  },
  staticData: {
    shell: shellRoutes.home,
  },
  component: HomeComponent,
});

function HomeComponent() {
  const health = Route.useLoaderData();

  return (
    <div className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-xl rounded-[1.5rem] border-line bg-surface/80">
        <CardHeader className="gap-3 px-5 pt-5">
          <div className="grid size-11 place-items-center rounded-xl bg-foreground text-background">
            <LightningIcon className="size-5" weight="fill" />
          </div>
          <CardTitle className="text-base">Canary web</CardTitle>
          <CardDescription>
            Realtime agent UI powered by TanStack Start and Electric.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="rounded-xl border border-line bg-surface/80 p-4">
            <h2 className="mb-2 text-sm font-medium">API Status</h2>
            <p className="text-sm text-muted-foreground">
              {health.ok ? 'oRPC, Start, and Query hydration are wired.' : 'API offline'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
