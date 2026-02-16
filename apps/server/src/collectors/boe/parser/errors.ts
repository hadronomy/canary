import { Schema } from "effect";

export class MissingRootDocumentoError extends Schema.TaggedError<MissingRootDocumentoError>()(
  "MissingRootDocumentoError",
  {
    message: Schema.String,
  },
) {}

export class InvalidMetadataError extends Schema.TaggedError<InvalidMetadataError>()(
  "InvalidMetadataError",
  {
    message: Schema.String,
  },
) {}

export class UnsupportedStrategyError extends Schema.TaggedError<UnsupportedStrategyError>()(
  "UnsupportedStrategyError",
  {
    strategyHint: Schema.String,
    message: Schema.String,
  },
) {}

export class MalformedTextSectionError extends Schema.TaggedError<MalformedTextSectionError>()(
  "MalformedTextSectionError",
  {
    message: Schema.String,
  },
) {}

export class NodePathCollisionError extends Schema.TaggedError<NodePathCollisionError>()(
  "NodePathCollisionError",
  {
    nodePath: Schema.String,
    message: Schema.String,
  },
) {}

export class EmptyFragmentContentError extends Schema.TaggedError<EmptyFragmentContentError>()(
  "EmptyFragmentContentError",
  {
    nodePath: Schema.String,
    message: Schema.String,
  },
) {}

export class XmlParseError extends Schema.TaggedError<XmlParseError>()("XmlParseError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export type BoeParseError =
  | MissingRootDocumentoError
  | InvalidMetadataError
  | UnsupportedStrategyError
  | MalformedTextSectionError
  | NodePathCollisionError
  | EmptyFragmentContentError
  | XmlParseError;
