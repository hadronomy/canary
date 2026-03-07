import { describe, expect, test } from "bun:test";

import type { HarnessClientAdapter } from "~/adapters/types";
import { codec } from "~/codec";
import {
  createHarnessClient,
  createHarnessEventViews,
  createInMemoryHarnessTurnRuntime,
  type HarnessEventResult,
} from "~/harness";
import {
  toEventIndex,
  toIdempotencyKey,
  toMessageId,
  toSessionId,
  toTurnId,
  type AnyEventEnvelope,
  type EventMap,
} from "~/protocol";

function toAsyncIterable<T>(values: ReadonlyArray<T>): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) {
        yield value;
      }
    },
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<Array<T>> {
  const values: Array<T> = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe("createInMemoryHarnessTurnRuntime", () => {
  test("deduplicates duplicate submit keys", async () => {
    let executions = 0;
    const runtime = createInMemoryHarnessTurnRuntime(async () => {
      executions += 1;
      return {
        turnId: toTurnId("turn-1"),
      };
    });

    const input = {
      sessionId: toSessionId("session-1"),
      idempotencyKey: toIdempotencyKey("idem-1"),
      content: "run",
    };

    const [first, second] = await Promise.all([
      runtime.submitTurn(input),
      runtime.submitTurn(input),
    ]);

    expect(first.turnId).toBe(toTurnId("turn-1"));
    expect(second.turnId).toBe(toTurnId("turn-1"));
    expect(executions).toBe(1);
  });
});

describe("createHarnessEventViews", () => {
  test("result stops at first terminal event", async () => {
    const events: ReadonlyArray<AnyEventEnvelope<EventMap>> = [
      {
        type: "assistant_text_delta",
        index: toEventIndex(0),
        sessionId: toSessionId("session-1"),
        turnId: toTurnId("turn-1"),
        ts: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          turnId: toTurnId("turn-1"),
          messageId: toMessageId("assistant-1"),
          delta: "hello",
        },
      },
      {
        type: "turn_done",
        index: toEventIndex(1),
        sessionId: toSessionId("session-1"),
        turnId: toTurnId("turn-1"),
        ts: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          turnId: toTurnId("turn-1"),
        },
      },
      {
        type: "turn_error",
        index: toEventIndex(2),
        sessionId: toSessionId("session-1"),
        turnId: toTurnId("turn-1"),
        ts: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          turnId: toTurnId("turn-1"),
          stage: "llm",
          retrying: false,
          code: "should-not-be-seen",
          message: "later terminal should not win",
        },
      },
    ];

    const views = createHarnessEventViews(() => toAsyncIterable(events));
    const result: HarnessEventResult = await views.result();

    expect(result.terminal).toBe("done");
    expect(result.text).toBe("hello");
    expect(result.events).toHaveLength(2);
  });

  test("concurrent views share one underlying stream", async () => {
    let streamFactoryCalls = 0;
    const events: ReadonlyArray<AnyEventEnvelope<EventMap>> = [
      {
        type: "assistant_text_delta",
        index: toEventIndex(0),
        sessionId: toSessionId("session-2"),
        turnId: toTurnId("turn-2"),
        ts: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          turnId: toTurnId("turn-2"),
          messageId: toMessageId("assistant-2"),
          delta: "SYNC",
        },
      },
      {
        type: "tool_execution_start",
        index: toEventIndex(1),
        sessionId: toSessionId("session-2"),
        turnId: toTurnId("turn-2"),
        ts: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          turnId: toTurnId("turn-2"),
          toolExecutionId: "tool-2" as never,
          toolName: "search",
        },
      },
      {
        type: "tool_execution_result",
        index: toEventIndex(2),
        sessionId: toSessionId("session-2"),
        turnId: toTurnId("turn-2"),
        ts: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          turnId: toTurnId("turn-2"),
          toolExecutionId: "tool-2" as never,
          ok: true,
          output: { ok: true },
        },
      },
      {
        type: "turn_done",
        index: toEventIndex(3),
        sessionId: toSessionId("session-2"),
        turnId: toTurnId("turn-2"),
        ts: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          turnId: toTurnId("turn-2"),
        },
      },
    ];

    const views = createHarnessEventViews(() => {
      streamFactoryCalls += 1;
      return toAsyncIterable(events);
    });

    const [deltas, tools, result] = await Promise.all([
      collect(views.deltas()),
      collect(views.tools()),
      views.result(),
    ]);

    expect(streamFactoryCalls).toBe(1);
    expect(deltas.join("")).toBe("SYNC");
    expect(tools).toHaveLength(2);
    expect(result.terminal).toBe("done");
    expect(result.text).toBe("SYNC");
  });
});

describe("createHarnessClient events ordering", () => {
  test("reorders out-of-order wire events and advances resume offset monotonically", async () => {
    const turnId = toTurnId("turn-ordering");
    const sessionId = "session-ordering";
    const offsets: Array<number> = [];

    const adapter: HarnessClientAdapter = {
      run: async () => ({
        output: {},
        turnId,
        nextIndex: 0,
      }),
      continue: async () => ({
        output: {},
        turnId,
        nextIndex: 0,
      }),
      steer: async () => {},
      followUp: async () => {},
      cancel: async () => {},
      events: () =>
        toAsyncIterable([
          {
            type: "assistant_text_delta",
            index: 1,
            turnId,
            sessionId,
            payload: codec.superJson.encode({
              turnId,
              messageId: toMessageId("assistant-1"),
              delta: "B",
            }),
          },
          {
            type: "assistant_text_delta",
            index: 0,
            turnId,
            sessionId,
            payload: codec.superJson.encode({
              turnId,
              messageId: toMessageId("assistant-1"),
              delta: "A",
            }),
          },
          {
            type: "turn_done",
            index: 2,
            turnId,
            sessionId,
            payload: codec.superJson.encode({
              turnId,
            }),
          },
        ]),
    };

    const client = createHarnessClient({
      agents: {
        testAgent: {
          input: codec.superJson,
          output: codec.superJson,
        },
      },
      adapter,
      resume: {
        setOffset: (offset) => {
          offsets.push(offset);
        },
      },
    });

    const events = client.events();
    const [deltas, result] = await Promise.all([collect(events.deltas()), events.result()]);

    expect(deltas.join("")).toBe("AB");
    expect(result.text).toBe("AB");
    expect(offsets).toEqual([1, 2, 3]);
  });
});
