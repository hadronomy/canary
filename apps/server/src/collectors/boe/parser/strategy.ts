import type { BoeMetadata, ParsingStrategy } from "./types";

const LEGISLATIVE_RANGE_CODES = new Set(["1320", "1340"]);

export const determineParsingStrategy = (metadata: BoeMetadata): ParsingStrategy => {
  if (LEGISLATIVE_RANGE_CODES.has(metadata.rangoCodigo)) {
    return "legislative";
  }
  if (metadata.seccion === "2" && metadata.subseccion.toUpperCase() === "B") {
    return "announcement";
  }
  if (metadata.seccion === "2") {
    return "simple";
  }
  return "generic";
};
