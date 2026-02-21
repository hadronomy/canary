import type { AstNodeId, NodePathSegment } from "./types";
import { AstNodeId as AstNodeIdBrand } from "./types";

interface NodeIdInput {
  readonly sequenceIndex: number;
  readonly nodeType: string;
  readonly nodePathSegments: ReadonlyArray<NodePathSegment>;
  readonly content: string;
}

const NODE_ID_HASH_SEED = 0n;

export function createAstNodeId(input: NodeIdInput): AstNodeId {
  const signature = `${input.nodeType}|${serializePath(input.nodePathSegments)}|${input.sequenceIndex}|${input.content}`;
  const hash = bunHashHex(signature);
  return AstNodeIdBrand(`node_${hash}`);
}

function serializePath(segments: ReadonlyArray<NodePathSegment>): string {
  return segments.map((segment) => `${segment._tag}:${segment.index}`).join("|");
}

function bunHashHex(value: string): string {
  const hash = Bun.hash(value, NODE_ID_HASH_SEED);
  return hash.toString(16).padStart(16, "0");
}
