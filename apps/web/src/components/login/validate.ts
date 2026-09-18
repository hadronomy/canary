import { useCallback, useEffect, useRef, useState } from 'react';

import type { Mode } from '~/components/login/use-auth';

// Deliberately loose. A login form's job is to catch the typo you can see, not
// to adjudicate RFC 5322 — anything stricter rejects addresses that work.
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const FIELDS: Record<Mode, readonly string[]> = {
  signin: ['email', 'password'],
  signup: ['name', 'email', 'password'],
};

type When = 'leave' | 'submit';

/**
 * Empty string means valid. Messages stay short because they are set on one
 * line beside the label, where anything longer would wrap or clip.
 *
 * An empty field is only a fault on submit. Tabbing through a field you have
 * not filled in yet is not a mistake, and flagging it as one punishes people
 * for moving around the form — the earliest fair moment to complain is when
 * someone leaves a field they actually put something in.
 */
function fault(name: string, value: string, mode: Mode, when: When) {
  // Say what to do, not what is wrong. "Required" names a rule; "Enter your
  // email" names the fix, and it is the same length.
  if (!value.trim()) return when === 'submit' ? `Enter your ${name}` : '';

  if (name === 'email') {
    return ADDRESS.test(value.trim()) ? '' : 'Use the format name@example.com';
  }

  if (name === 'password') {
    // An existing password is already whatever length it is. Only a new one has
    // a floor, and counting down is more use than restating the rule.
    if (mode === 'signup' && value.length < 8) {
      const left = 8 - value.length;
      return `Add ${left} more character${left === 1 ? '' : 's'}`;
    }
    return '';
  }

  return '';
}

/**
 * Per-field validation on the "reward early, punish late" schedule.
 *
 * A field in good standing is judged only when you leave it, so nobody is
 * corrected mid-word. A field already in error is re-judged on every keystroke,
 * so the message clears the instant it is fixed rather than making you tab away
 * to find out. Empty fields wait for submit — see `fault`.
 */
function useValidate(mode: Mode) {
  const [bad, setBad] = useState<Record<string, string>>({});
  const left = useRef(new Set<string>());

  // The rules differ between modes, so a stale message would be wrong rather
  // than merely out of date.
  useEffect(() => {
    left.current.clear();
    setBad({});
  }, [mode]);

  const put = useCallback((name: string, message: string) => {
    setBad((prev) => (prev[name] === message ? prev : { ...prev, [name]: message }));
  }, []);

  const blur = useCallback(
    (name: string, value: string) => {
      left.current.add(name);
      put(name, fault(name, value, mode, 'leave'));
    },
    [mode, put],
  );

  const change = useCallback(
    (name: string, value: string) => {
      if (!left.current.has(name)) return;
      put(name, fault(name, value, mode, 'leave'));
    },
    [mode, put],
  );

  /** Checks every field at once and returns the first that fails, so the caller
   *  can put the cursor where the problem is. */
  const all = useCallback(
    (form: HTMLFormElement) => {
      const next: Record<string, string> = {};
      let first: string | null = null;

      for (const name of FIELDS[mode]) {
        const input = form.elements.namedItem(name);
        const value = input instanceof HTMLInputElement ? input.value : '';
        left.current.add(name);
        next[name] = fault(name, value, mode, 'submit');
        if (next[name] && !first) first = name;
      }

      setBad(next);
      return first;
    },
    [mode],
  );

  return { bad, blur, change, all };
}

export { useValidate };
