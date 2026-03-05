import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { Serde } from "@restatedev/restate-sdk";
import { TerminalError, type Context, type RunOptions } from "@restatedev/restate-sdk";

import { defineCodec, SuperJsonCodec, type Codec } from "~/codec";

export class SuperJsonSerde<T> extends SuperJsonCodec<T> {}

export const superJson = new SuperJsonSerde<unknown>();

export function toRestateSerde<T>(codec: Codec<T>): Serde<T> {
  return codec.asSerde();
}

export function fromRestateSerde<T>(serde: Serde<T>): Codec<T, T> {
  return defineCodec({
    contentType: serde.contentType,
    jsonSchema: serde.jsonSchema,
    encode: (value) => value,
    decode: (value) => value as T,
    serialize: (value) => serde.serialize(value),
    deserialize: (data) => serde.deserialize(data),
  });
}

function getSuperJsonSerde<T>(): Serde<T> {
  return superJson as Serde<T>;
}

function hasNameAndCode(value: unknown): value is { readonly name: string; readonly code: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { readonly name?: unknown; readonly code?: unknown };
  const maybeName = candidate.name;
  const maybeCode = candidate.code;

  return typeof maybeName === "string" && typeof maybeCode === "number";
}

export function isTerminalError(err: unknown): boolean {
  if (err instanceof TerminalError) return true;

  if (!hasNameAndCode(err)) {
    return false;
  }

  return (
    (err.name === "TerminalError" && err.code !== undefined) ||
    (err.name === "TimeoutError" && err.code === 408) ||
    (err.name === "CancelledError" && err.code === 409)
  );
}

export function durableCalls(
  ctx: Context,
  opts?: {
    llm?: RunOptions<AssistantMessage>;
    tool?: RunOptions<unknown>;
    publish?: RunOptions<void>;
  },
) {
  const llmOptions: RunOptions<AssistantMessage> = {
    serde: getSuperJsonSerde<AssistantMessage>(),
    ...opts?.llm,
  };

  const toolOptions: RunOptions<unknown> = {
    serde: superJson,
    ...opts?.tool,
  };

  const publishOptions: RunOptions<void> = {
    ...opts?.publish,
  };

  return {
    runLlmFinal: (key: string, fn: () => Promise<AssistantMessage>) =>
      ctx.run(`llm:${key}`, fn, llmOptions),

    runTool: (key: string, fn: () => Promise<unknown>) => ctx.run(`tool:${key}`, fn, toolOptions),

    runPublish: (key: string, fn: () => Promise<void>) =>
      ctx.run(`publish:${key}`, fn, publishOptions),
  };
}
