import superjson from "superjson";

import type { StandardJSONSchemaV1, StandardSchemaV1 } from "~/standard-schema";

export interface CodecSerde<T> {
  readonly contentType?: string;
  readonly jsonSchema?: object;

  serialize(value: T): Uint8Array;
  deserialize(data: Uint8Array): T;
}

export interface Codec<T, TWire = unknown> extends CodecSerde<T> {
  readonly encode: (value: T) => TWire;
  readonly decode: (value: TWire) => T;
  readonly asSerde: () => CodecSerde<T>;
}

class BinaryCodec implements Codec<Uint8Array, Uint8Array> {
  readonly contentType = "application/octet-stream";

  encode(value: Uint8Array): Uint8Array {
    return value;
  }

  decode(value: Uint8Array): Uint8Array {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError("Expected Uint8Array value");
    }

    return value;
  }

  serialize(value: Uint8Array): Uint8Array {
    return value;
  }

  deserialize(data: Uint8Array): Uint8Array {
    return data;
  }

  asSerde(): CodecSerde<Uint8Array> {
    return this;
  }
}

class VoidCodec implements Codec<void, undefined> {
  encode(value: void): undefined {
    if (value !== undefined) {
      throw new TypeError("Expected undefined value");
    }

    return undefined;
  }

  decode(value: undefined): void {
    if (value !== undefined) {
      throw new TypeError("Expected undefined value");
    }
  }

  serialize(value: void): Uint8Array {
    if (value !== undefined) {
      throw new TypeError("Expected undefined value");
    }

    return new Uint8Array(0);
  }

  deserialize(data: Uint8Array): void {
    if (data.length !== 0) {
      throw new TypeError("Expected empty data");
    }
  }

  asSerde(): CodecSerde<void> {
    return this;
  }
}

export class JsonCodec<T> implements Codec<T | undefined, string> {
  readonly contentType = "application/json";

  constructor(readonly jsonSchema?: object) {}

  encode(value: T | undefined): string {
    if (value === undefined) {
      return "";
    }

    return JSON.stringify(value);
  }

  decode(value: string): T | undefined {
    if (value === "") {
      return undefined;
    }

    return JSON.parse(value) as T;
  }

  serialize(value: T | undefined): Uint8Array {
    if (value === undefined) {
      return new Uint8Array(0);
    }

    return new TextEncoder().encode(JSON.stringify(value));
  }

  deserialize(data: Uint8Array): T | undefined {
    if (data.length === 0) {
      return undefined;
    }

    return JSON.parse(new TextDecoder().decode(data)) as T;
  }

  schema<U>(schema: object): Codec<U> {
    return new JsonCodec<U>(schema) as Codec<U>;
  }

  asSerde(): CodecSerde<T | undefined> {
    return this;
  }
}

export class SuperJsonCodec<T> implements Codec<T, string> {
  readonly contentType = "application/json";

  encode(value: T): string {
    return superjson.stringify(value);
  }

  decode(value: unknown): T {
    if (typeof value !== "string") {
      throw new TypeError("SuperJsonCodec.decode expects a string payload");
    }

    return superjson.parse<T>(value);
  }

  serialize(value: T): Uint8Array {
    return new TextEncoder().encode(superjson.stringify(value));
  }

  deserialize(data: Uint8Array): T {
    return superjson.parse<T>(new TextDecoder().decode(data));
  }

  asSerde(): CodecSerde<T> {
    return this;
  }
}

class StandardSchemaCodec<
  T extends { readonly "~standard": StandardSchemaV1.Props },
> implements Codec<StandardSchemaV1.InferOutput<T>, string> {
  contentType: string | undefined = "application/json";
  jsonSchema?: object;

  constructor(
    private readonly schema: T,
    private readonly validateOptions?: Record<string, unknown>,
    jsonSchemaOptions?: Record<string, unknown>,
  ) {
    const standard = schema["~standard"];

    if (isStandardJSONSchemaV1(standard)) {
      try {
        this.jsonSchema = standard.jsonSchema.output({
          target: "draft-2020-12",
          libraryOptions: jsonSchemaOptions,
        });
      } catch {
        this.jsonSchema = undefined;
      }
    }

    const testResult = standard.validate(undefined);
    if (!isPromiseLike(testResult) && !testResult.issues) {
      this.contentType = undefined;
    }
  }

  encode(value: StandardSchemaV1.InferOutput<T>): string {
    if (value === undefined) {
      return "";
    }

    return JSON.stringify(value);
  }

  decode(value: string): StandardSchemaV1.InferOutput<T> {
    const parsed = value === "" ? undefined : (JSON.parse(value) as unknown);
    return this.validate(parsed);
  }

  serialize(value: StandardSchemaV1.InferOutput<T>): Uint8Array {
    if (value === undefined) {
      return new Uint8Array(0);
    }

    return new TextEncoder().encode(JSON.stringify(value));
  }

  deserialize(data: Uint8Array): StandardSchemaV1.InferOutput<T> {
    const parsed = data.length === 0 ? undefined : JSON.parse(new TextDecoder().decode(data));
    return this.validate(parsed);
  }

  asSerde(): CodecSerde<StandardSchemaV1.InferOutput<T>> {
    return this;
  }

  private validate(value: unknown): StandardSchemaV1.InferOutput<T> {
    const result = this.schema["~standard"].validate(
      value,
      this.validateOptions === undefined ? undefined : { libraryOptions: this.validateOptions },
    );

    if (isPromiseLike(result)) {
      throw new TypeError(
        "Async validation is not supported in Codec. Restate Serde supports only synchronous validation.",
      );
    }

    if (result.issues) {
      const errorMessages = result.issues.map(formatStandardSchemaIssue).join("\n");
      throw new TypeError(`Standard schema validation failed:\n${errorMessages}`);
    }

    return result.value as StandardSchemaV1.InferOutput<T>;
  }
}

export function identityCodec<T>(): Codec<T, T> {
  return defineCodec({
    encode: (value) => value,
    decode: (value) => value as T,
    serialize: (value) => new TextEncoder().encode(superjson.stringify(value)),
    deserialize: (data) => superjson.parse<T>(new TextDecoder().decode(data)),
  });
}

export function defineCodec<T, TWire>(codec: {
  readonly contentType?: string;
  readonly jsonSchema?: object;
  readonly encode: (value: T) => TWire;
  readonly decode: (value: TWire) => T;
  readonly serialize: (value: T) => Uint8Array;
  readonly deserialize: (data: Uint8Array) => T;
}): Codec<T, TWire> {
  const serialize = codec.serialize;
  const deserialize = codec.deserialize;

  return {
    contentType: codec.contentType,
    jsonSchema: codec.jsonSchema,
    encode: codec.encode,
    decode: codec.decode,
    serialize,
    deserialize,
    asSerde() {
      return {
        contentType: codec.contentType,
        jsonSchema: codec.jsonSchema,
        serialize,
        deserialize,
      };
    },
  };
}

export function standardSchemaCodec<T extends { readonly "~standard": StandardSchemaV1.Props }>(
  schema: T,
  validateOptions?: Record<string, unknown>,
  jsonSchemaOptions?: Record<string, unknown>,
): Codec<StandardSchemaV1.InferOutput<T>, string> {
  return new StandardSchemaCodec(schema, validateOptions, jsonSchemaOptions);
}

export function superJsonCodec<T>(): Codec<T, string> {
  return new SuperJsonCodec<T>();
}

export function toSerde<T>(codec: Codec<T>): CodecSerde<T> {
  return codec.asSerde();
}

export function fromSerde<T>(serde: CodecSerde<T>): Codec<T, T> {
  return defineCodec({
    contentType: serde.contentType,
    jsonSchema: serde.jsonSchema,
    encode: (value) => value,
    decode: (value) => value as T,
    serialize: (value) => serde.serialize(value),
    deserialize: (data) => serde.deserialize(data),
  });
}

function formatStandardSchemaIssue(issue: StandardSchemaV1.Issue): string {
  if (issue.path && issue.path.length > 0) {
    const jsonPointer =
      "/" +
      issue.path
        .map((segment) => {
          if (typeof segment === "object" && segment !== null && "key" in segment) {
            return String(segment.key);
          }

          return String(segment);
        })
        .join("/");

    return `* (at ${jsonPointer}) ${issue.message}`;
  }

  return `* ${issue.message}`;
}

function isStandardJSONSchemaV1(
  standard: StandardSchemaV1.Props,
): standard is StandardSchemaV1.Props & { readonly jsonSchema: StandardJSONSchemaV1.Converter } {
  return (
    standard !== undefined &&
    "jsonSchema" in standard &&
    typeof standard.jsonSchema === "object" &&
    standard.jsonSchema !== null &&
    "output" in standard.jsonSchema &&
    typeof standard.jsonSchema.output === "function"
  );
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

export const codec = {
  JsonCodec,
  json: new JsonCodec<unknown>(),
  superJson: new SuperJsonCodec<unknown>(),
  binary: new BinaryCodec(),
  empty: new VoidCodec(),
  schema: <T extends { readonly "~standard": StandardSchemaV1.Props }>(
    schema: T,
    validateOptions?: Record<string, unknown>,
    jsonSchemaOptions?: Record<string, unknown>,
  ): Codec<StandardSchemaV1.InferOutput<T>, string> =>
    new StandardSchemaCodec(schema, validateOptions, jsonSchemaOptions),
};
