import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { COMMIT } from 'virtual:commit';
import { z } from 'zod';

import { Backdrop } from '~/components/backdrop/backdrop';
import { pageTexture } from '~/components/backdrop/page-texture';
import shader from '~/components/backdrop/scout.wgsl';
import { useField } from '~/components/backdrop/use-field';
import { PROVIDERS, Providers } from '~/components/login/providers';
import { useAuth } from '~/components/login/use-auth';
import { useValidate } from '~/components/login/validate';
import { Check, Fade, Spin, Swap, jolt } from '~/lib/motion';

export const Route = createFileRoute('/login')({
  // `?social=1` previews the page with the provider row in place. Coerced
  // because the router parses a bare numeric param as a number, not a string.
  validateSearch: z.object({
    redirect: z.string().optional(),
    social: z.coerce.string().optional(),
  }),
  component: Login,
});

function Login() {
  const params = Route.useSearch();
  const auth = useAuth(params.redirect);
  const field = useField({ quiet: [0, 0, 0, 0] });
  const check = useValidate(auth.mode);
  const form = useRef<HTMLFormElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  // Stands in for "providers are configured" until any actually are. Email is
  // the only way in today, so it is never put behind a disclosure — hiding the
  // sole path costs everyone a click and saves nobody anything.
  const configured = params.social === '1' && PROVIDERS.length > 0;
  const disclosed = !configured || open;

  function reveal() {
    setOpen(true);
    // After the grow starts, so focus does not land in a zero-height track.
    requestAnimationFrame(() => email.current?.focus());
  }

  const bind = useCallback(async (gpu: Parameters<typeof pageTexture>[0]) => {
    const { sampler } = await import('vgpu');
    return {
      page: await pageTexture(gpu),
      samp: sampler(gpu, {
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
      }),
    };
  }, []);

  useLayoutEffect(() => {
    field.aimAt(form.current);

    const node = form.current;
    if (!node) return;

    // The corpus clears where the form is, measured with enough padding that
    // the resolved setting never crowds the type. Observed rather than computed
    // once, because the provider row and the error lines change its height.
    function clear() {
      if (!node) return;
      const box = node.getBoundingClientRect();
      field.put('quiet', [
        (box.left - 140) / innerWidth,
        (box.top - 80) / innerHeight,
        (box.width + 280) / innerWidth,
        (box.height + 160) / innerHeight,
      ]);
    }

    clear();
    const ro = new ResizeObserver(clear);
    ro.observe(node);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [field]);

  // A rejected attempt collapses the rerank, shakes the form, and puts the
  // cursor back in the password with its contents selected — retyping is the
  // next thing anyone does, so make it one keystroke away.
  useEffect(() => {
    if (auth.phase !== 'error') return;
    field.fault(true);
    jolt(form.current);

    const pw = form.current?.elements.namedItem('password');
    if (pw instanceof HTMLInputElement) {
      pw.focus();
      pw.select();
    }

    const id = setTimeout(() => field.fault(false), 900);
    return () => clearTimeout(id);
  }, [auth.phase, auth.attempt, field]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    const node = event.currentTarget;
    const first = check.all(node);
    if (!first) {
      void auth.submit(event);
      return;
    }

    event.preventDefault();
    jolt(node);
    const input = node.elements.namedItem(first);
    if (input instanceof HTMLInputElement) input.focus();
  }

  return (
    <main className="canary-ink relative grid min-h-svh grid-rows-[auto_1fr_auto] overflow-hidden">
      <Backdrop shader={shader} state={field.state} bind={bind} />

      <header className="relative z-10 px-12 pt-9">
        <span className="text-[14px] tracking-[-0.01em] text-[var(--text)]">canary</span>
      </header>

      <div className="relative z-10 grid place-items-center px-12 py-8">
        <form ref={form} onSubmit={submit} noValidate className="w-full max-w-[21rem]">
          {/* Código Civil, art. 6.1: "La ignorancia de las leyes no excusa de su
              cumplimiento." Every reader of Spanish law knows the line, and on
              the door of a tool that reads the law for you it lands as a wink
              rather than a warning. The citation is set under it because citing
              is what this product does. */}
          <h1 className="text-[30px] leading-[1.14] tracking-[-0.028em] text-balance text-[var(--text)]">
            <Swap
              value={
                auth.mode === 'signin' ? 'Ignorance of the law is no excuse.' : 'Create an account.'
              }
            />
          </h1>
          <p className="code mt-2 text-[11px] text-[var(--text-faint)]">
            <Swap value={auth.mode === 'signin' ? 'Código Civil, art. 6.1' : ' '} />
          </p>
          <p className="mt-4 max-w-[34ch] text-[13px] leading-relaxed text-[var(--text-dim)]">
            Canary finds the article that answers your question, in the version in force on the date
            you need.
          </p>

          {configured ? (
            <div className="mt-9">
              <Providers />
              <div className="mt-6 flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-[var(--line)]" />
                <span className="code text-[11px] text-[var(--text-dim)]">or</span>
                <span className="h-px flex-1 bg-[var(--line)]" />
              </div>
            </div>
          ) : null}

          {/* The trigger collapses as the fields grow, so the two read as one
              gesture rather than a control vanishing and a block appearing. */}
          {configured ? (
            <div className="t-grow" data-open={!open} inert={open}>
              <div>
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={reveal}
                    aria-expanded={open}
                    aria-controls="email-path"
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-[4px] text-[12px] text-[var(--text-dim)] shadow-[inset_0_0_0_1px_var(--line)] transition-[color,box-shadow,transform] duration-150 ease-out hover:text-[var(--text)] hover:shadow-[inset_0_0_0_1px_rgb(233_235_236/0.34)] active:scale-[0.98]"
                  >
                    Continue with email
                    <svg viewBox="0 0 12 12" aria-hidden className="size-3">
                      <path
                        d="M2.5 4.5 6 8l3.5-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Collapsed with `inert` rather than merely clipped: a zero-height
              grid track still holds focusable fields, and tabbing into a form
              nobody can see is worse than not offering it. */}
          <div id="email-path" className="t-grow" data-open={disclosed} inert={!disclosed}>
            <div>
              {/* The top margin belongs to the undisclosed layout, where the
                  fields follow the paragraph directly. Behind the rule they
                  need far less. */}
              <div className={configured ? 'pt-6' : 'mt-9'}>
                {/* The name field sits outside the gapped stack and carries its
                    own spacing, because a collapsed child of a `gap` container
                    still claims a gap on both sides — 20px of nothing above
                    Email whenever this is closed. */}
                <div className="t-grow" data-open={auth.mode === 'signup'}>
                  <div>
                    <div className="pb-5">
                      <Input
                        label="Name"
                        name="name"
                        autoComplete="name"
                        field={field}
                        check={check}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-5">
                  <Input
                    ref={email}
                    label="Email"
                    name="email"
                    type="email"
                    autoFocus={!configured}
                    autoComplete="email"
                    field={field}
                    check={check}
                  />
                  <Input
                    label="Password"
                    name="password"
                    type="password"
                    autoComplete={auth.mode === 'signin' ? 'current-password' : 'new-password'}
                    field={field}
                    check={check}
                  />
                </div>

                {/* Reserved, so a rejection never shoves the button out from under
              the cursor that is about to press it again. */}
                <p
                  role="alert"
                  className="mt-5 min-h-4 text-[12px] leading-4 text-[var(--bad)] transition-[opacity,transform,filter] duration-200 ease-out"
                  style={{
                    opacity: auth.err ? 1 : 0,
                    transform: auth.err ? 'none' : 'translateY(-3px)',
                    filter: auth.err ? 'none' : 'blur(2px)',
                  }}
                >
                  {auth.err ?? ' '}
                </p>

                <button
                  type="submit"
                  disabled={auth.phase === 'working' || auth.phase === 'done'}
                  className="group relative mt-2 grid h-11 w-full place-items-center overflow-hidden rounded-[4px] text-[13px] shadow-[inset_0_0_0_1px_rgb(233_235_236/0.22)] transition-transform duration-150 ease-out active:scale-[0.99] disabled:cursor-default"
                >
                  {/* The fill wipes in from the left rather than fading: a growing
                edge is the same gesture as the rerank resolving outward. */}
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-[var(--ink)] transition-[clip-path] duration-300 [clip-path:inset(0_100%_0_0)] ease-[var(--ease-out-strong)] group-hover:[clip-path:inset(0_0_0_0)] group-focus-visible:[clip-path:inset(0_0_0_0)]"
                  />
                  <span className="relative flex w-full items-center justify-between px-4">
                    <span className="grid">
                      <span className="grid [grid-area:1/1] justify-items-start">
                        <Fade show={auth.phase === 'idle' || auth.phase === 'error'}>
                          <span className="text-[var(--text)] transition-colors duration-200 group-hover:text-black">
                            {auth.mode === 'signin' ? 'Sign in' : 'Create account'}
                          </span>
                        </Fade>
                      </span>
                      <span className="grid [grid-area:1/1] justify-items-start">
                        <Fade show={auth.phase === 'working'}>
                          <Spin className="size-4 animate-spin text-[var(--text)]" />
                        </Fade>
                      </span>
                      <span className="grid [grid-area:1/1] justify-items-start">
                        <Fade show={auth.phase === 'done'}>
                          <Check className="size-4 text-[var(--text)] group-hover:text-black" />
                        </Fade>
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="code text-[12px] text-[var(--text-dim)] transition-colors duration-200 group-hover:text-black/60"
                    >
                      &#8617;
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={auth.swap}
            className="mt-4 text-[12px] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]"
          >
            {auth.mode === 'signin' ? 'Create an account' : 'Sign in instead'}
          </button>
        </form>
      </div>

      <footer className="code relative z-10 flex justify-end px-12 pb-9 text-[10px] text-[var(--text-faint)]">
        <span title="Checked-out commit">{COMMIT}</span>
      </footer>
    </main>
  );
}

type InputProps = React.ComponentProps<'input'> & {
  label: string;
  name: string;
  field: ReturnType<typeof useField>;
  check: ReturnType<typeof useValidate>;
};

/**
 * A rule under the field rather than a box around it: on a page whose whole
 * subject is resolution, a drawn container is one more thing to resolve.
 *
 * The rule is also what carries state. Focus fills it left to right; a fault
 * fills it the same way in the fault tone and holds it there, so the error is
 * the focus gesture rather than a separate badge bolted beside it.
 */
function Input({ label, name, field, check, className, ...rest }: InputProps) {
  const [on, setOn] = useState(false);
  const [caps, setCaps] = useState(false);
  const [see, setSee] = useState(false);
  const wrap = useRef<HTMLLabelElement>(null);
  const said = `${useId()}-note`;

  const secret = rest.type === 'password';
  const wrong = Boolean(check.bad[name]);
  // Caps Lock is advice, not a fault, so it never outranks a real message.
  const note = check.bad[name] || (caps && secret ? 'Caps Lock is on' : '');

  return (
    <label ref={wrap} className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span
          className="code text-[11px] transition-colors duration-200"
          style={{ color: wrong ? 'var(--bad)' : 'var(--text-dim)' }}
        >
          {label}
        </span>
        {/* Set on the label's own line so a message can never move the field
            it belongs to, or the button underneath it. */}
        <span
          id={said}
          className="code text-[11px] transition-[opacity,transform,filter] duration-200 ease-out"
          style={{
            color: wrong ? 'var(--bad)' : 'var(--text-dim)',
            opacity: note ? 1 : 0,
            transform: note ? 'none' : 'translateY(-2px)',
            filter: note ? 'none' : 'blur(2px)',
          }}
        >
          {note || ' '}
        </span>
      </span>

      <span className="relative block">
        <input
          {...rest}
          name={name}
          type={secret && see ? 'text' : rest.type}
          aria-invalid={wrong}
          // Points at the message so a screen reader reads the fault with the
          // field rather than leaving it as unannounced colour.
          aria-describedby={note ? said : undefined}
          onFocus={() => {
            setOn(true);
            field.focus(true);
            field.aimAt(wrap.current);
          }}
          onBlur={(e) => {
            setOn(false);
            setCaps(false);
            field.focus(false);
            check.blur(name, e.currentTarget.value);
          }}
          onChange={(e) => check.change(name, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (secret) setCaps(e.getModifierState('CapsLock'));
            field.beat();
          }}
          className={[
            'mt-1.5 h-8 w-full bg-transparent text-[17px] tracking-[-0.01em] text-[var(--text)] outline-none',
            'caret-[var(--ink)] placeholder:text-[var(--text-faint)]',
            secret ? 'pr-12' : '',
            className ?? '',
          ].join(' ')}
        />
        {secret ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setSee((s) => !s)}
            className="code absolute right-0 bottom-1.5 text-[11px] text-[var(--text-dim)] transition-colors duration-150 hover:text-[var(--text)]"
          >
            {see ? 'hide' : 'show'}
          </button>
        ) : null}
      </span>

      <span
        className="relative block h-px w-full transition-colors duration-200"
        style={{ background: wrong ? 'var(--bad-line)' : 'var(--line)' }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 transition-[width,background-color] duration-[250ms] ease-[var(--ease-out-strong)]"
          style={{
            width: wrong || on ? '100%' : '0%',
            background: wrong ? 'var(--bad)' : 'var(--ink)',
          }}
        />
      </span>
    </label>
  );
}
