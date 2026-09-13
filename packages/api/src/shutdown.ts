import type * as ManagedRuntime from 'effect/ManagedRuntime';

import type * as Run from '@canary/api/runner';

declare global {
  var canaryRunRuntime: ManagedRuntime.ManagedRuntime<Run.Service, unknown> | undefined;
}

export async function close() {
  const runtime = globalThis.canaryRunRuntime;
  if (!runtime) return;

  await runtime.dispose();
  if (globalThis.canaryRunRuntime === runtime) globalThis.canaryRunRuntime = undefined;
}
