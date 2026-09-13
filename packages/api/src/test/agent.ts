import { Deferred, Effect } from 'effect';

type Piece =
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'text-end'; id: string };

export type Input = {
  runId: string;
  piece: (piece: Piece) => Promise<void> | void;
  finish: (text: string, data: Record<string, unknown>) => Promise<void> | void;
  fail: (error: Error) => Promise<void> | void;
};

export const state = {
  calls: 0,
  cancels: 0,
  cleanups: 0,
  mode: 'finish' as 'fail' | 'finish' | 'hold',
  input: undefined as Input | undefined,
  started: Deferred.makeUnsafe<void>(),
  stopped: Deferred.makeUnsafe<void>(),
};

export function reset() {
  state.calls = 0;
  state.cancels = 0;
  state.cleanups = 0;
  state.mode = 'finish';
  state.input = undefined;
  state.started = Deferred.makeUnsafe();
  state.stopped = Deferred.makeUnsafe();
}

export async function open(input: Input) {
  state.calls += 1;
  state.input = input;
  Deferred.doneUnsafe(state.started, Effect.void);

  if (state.mode === 'finish') {
    await input.piece({ type: 'text-start', id: 'answer' });
    await input.piece({ type: 'text-delta', id: 'answer', text: 'ok' });
    await input.piece({ type: 'text-end', id: 'answer' });
    await input.finish('ok', { reason: 'done' });
  }

  if (state.mode === 'fail') {
    await input.piece({ type: 'text-start', id: 'answer' });
    await input.piece({ type: 'text-delta', id: 'answer', text: 'partial' });
    await input.fail(new Error('provider failed'));
  }

  return {
    runId: input.runId,
    cleanup() {
      state.cleanups += 1;
      Deferred.doneUnsafe(state.stopped, Effect.void);
    },
  };
}

export async function cancel() {
  state.cancels += 1;
}
