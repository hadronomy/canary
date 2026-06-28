import { LightningIcon } from '@phosphor-icons/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

const search = z.object({
  client_id: z.string().optional(),
  code: z.string().optional(),
  scope: z.string().optional(),
});

export const Route = createFileRoute('/consent')({
  validateSearch: search,
  component: ConsentComponent,
});

function ConsentComponent() {
  const nav = useNavigate();
  const params = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    if (!params.code) {
      setErr('Consent code is missing.');
      return;
    }

    setBusy(true);
    setErr(null);

    const res = await fetch('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        code: params.code,
        accept: true,
      }),
    });

    setBusy(false);

    if (!res.ok) {
      setErr(await res.text());
      return;
    }

    const url = res.headers.get('location');

    if (url) {
      window.location.href = url;
      return;
    }

    await nav({ to: '/threads' });
  }

  return (
    <main className="canary-shell grid min-h-svh place-items-center px-4 py-8">
      <Card className="canary-panel w-full max-w-md rounded-[1.5rem] border-line bg-surface/95">
        <CardHeader className="gap-3 px-5 pt-5">
          <div className="grid size-11 place-items-center rounded-xl bg-foreground text-background">
            <LightningIcon className="size-5" weight="fill" />
          </div>
          <CardTitle className="text-base">Authorize MCP access</CardTitle>
          <CardDescription>
            {params.client_id ?? 'A client'} is requesting {params.scope ?? 'default'} scopes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-5 pb-5">
          {err ? <p className="text-destructive text-xs">{err}</p> : null}
          <Button className="rounded-xl" disabled={busy} onClick={accept}>
            {busy ? 'Authorizing...' : 'Authorize'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
