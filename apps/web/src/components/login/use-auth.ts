import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';

import { userKey, userOptions } from '~/functions/get-user';
import { authClient } from '~/lib/auth-client';

type Mode = 'signin' | 'signup';

/**
 * `done` is a real phase rather than an immediate redirect: it holds the
 * confirmation on screen long enough to be seen. Signing in is a rare moment,
 * so it is one of the few places a celebration earns its keep.
 */
type Phase = 'idle' | 'working' | 'error' | 'done';

const HOLD = 620;

/** Shared sign-in / sign-up behaviour. The three login variants differ only in
 *  how they present this, never in what it does. */
function useAuth(redirect?: string) {
  const cache = useQueryClient();
  const nav = useNavigate();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);

  // Bumped on every failure so a repeated rejection replays its animation
  // instead of sitting there looking like nothing happened.
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy.current) return;
      busy.current = true;
      setPhase('working');
      setErr(null);

      const form = new FormData(event.currentTarget);
      const email = String(form.get('email') ?? '');
      const password = String(form.get('password') ?? '');
      const name = String(form.get('name') || email.split('@')[0] || email);

      const res =
        mode === 'signin'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name });

      function reject(message: string) {
        busy.current = false;
        setAttempt((n) => n + 1);
        setErr(message);
        setPhase('error');
      }

      if (res.error) return reject(res.error.message ?? 'Sign-in failed. Try again.');

      await cache.invalidateQueries({ queryKey: userKey });
      const user = await cache.fetchQuery(userOptions());
      if (!user) return reject('Sign-in failed. Try again.');

      cache.setQueryData(userKey, user);
      await router.invalidate();
      setPhase('done');

      // Let the confirmation land before the route swaps out from under it.
      setTimeout(() => void nav({ to: redirect ?? '/threads' }), HOLD);
    },
    [cache, mode, nav, redirect, router],
  );

  const swap = useCallback(() => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setPhase('idle');
    setErr(null);
  }, []);

  return { mode, phase, err, attempt, submit, swap };
}

export { useAuth };
export type { Mode, Phase };
