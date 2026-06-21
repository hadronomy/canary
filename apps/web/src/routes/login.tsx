import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { userKey, userOptions } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';

const search = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute('/login')({
  validateSearch: search,
  component: LoginComponent,
});

function LoginComponent() {
  const ctx = Route.useRouteContext();
  const nav = useNavigate();
  const params = Route.useSearch();
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErr(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const name = String(form.get('name') ?? email);
    const res =
      mode === 'signin'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });

    if (res.error) {
      setBusy(false);
      setErr(res.error.message ?? 'Authentication failed');
      return;
    }

    await ctx.queryClient.invalidateQueries({ queryKey: userKey });
    const user = await ctx.queryClient.fetchQuery(userOptions());

    if (!user) {
      setBusy(false);
      setErr('Authentication session was not created');
      return;
    }

    ctx.queryClient.setQueryData(userKey, user);
    await router.invalidate();
    setBusy(false);
    await nav({ to: params.redirect ?? '/threads' });
  }

  return (
    <main className="grid min-h-full place-items-center px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === 'signin' ? 'Welcome back' : 'Create account'}</CardTitle>
          <CardDescription>Sign in to sync agent threads across every client.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={submit}>
            {mode === 'signup' ? (
              <div className="grid gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Ada" />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" placeholder="you@example.com" required type="email" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" minLength={8} name="password" required type="password" />
            </div>
            {err ? <p className="text-destructive text-xs">{err}</p> : null}
            <Button disabled={busy} type="submit">
              {busy ? 'Working...' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setErr(null);
              }}
            >
              {mode === 'signin' ? 'Need an account?' : 'Already have an account?'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
