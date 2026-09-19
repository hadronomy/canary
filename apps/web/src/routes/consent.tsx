import { LightningIcon } from '@phosphor-icons/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '~/components/ui/button';

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
    <main className="canary-ink grid min-h-svh place-items-center px-6 py-10">
      <div className="w-full max-w-[21rem]">
        <span
          aria-hidden
          className="mb-6 grid size-9 place-items-center rounded-[0.6rem] bg-[var(--ink)] text-[var(--on-ink)]"
        >
          <LightningIcon className="size-5" weight="fill" />
        </span>

        <h1 className="text-[26px] leading-[1.18] tracking-[-0.025em] text-balance text-[var(--text)]">
          Authorize access
        </h1>

        <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">
          <span className="code text-[var(--text)]">{params.client_id ?? 'A client'}</span> is
          asking for <span className="code text-[var(--text)]">{params.scope ?? 'default'}</span>{' '}
          scopes on your account.
        </p>

        {err ? (
          <p className="mt-4 border-l pl-3 text-sm text-[var(--bad)] [border-color:var(--bad-line)]">
            {err}
          </p>
        ) : null}

        <Button
          className="mt-7 h-10 w-full bg-[var(--ink)] text-[var(--on-ink)] hover:bg-[var(--ink)]"
          disabled={busy}
          onClick={accept}
        >
          {busy ? 'Authorizing…' : 'Authorize'}
        </Button>
      </div>
    </main>
  );
}
