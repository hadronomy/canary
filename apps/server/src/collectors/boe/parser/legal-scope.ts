import type { NodeType } from "@canary/db/schema/legislation";

import { normalizeLegalPathSegment } from "./normalize";
import type { DispositionPathScope, LegalPathSegment } from "./types";

export const LEGAL_DISPOSITION_SCOPES = [
  "disposicion-adicional",
  "disposicion-final",
  "disposicion-transitoria",
  "disposicion-derogatoria",
] as const satisfies ReadonlyArray<DispositionPathScope>;

const LEGAL_SCOPE_RULES: ReadonlyArray<{
  readonly match: RegExp;
  readonly scope: DispositionPathScope;
  readonly nodeType: NodeType;
}> = [
  {
    match: /ADICIONAL/,
    scope: "disposicion-adicional",
    nodeType: "chapter",
  },
  {
    match: /TRANSITORIA/,
    scope: "disposicion-transitoria",
    nodeType: "disposicion_transitoria",
  },
  {
    match: /FINAL/,
    scope: "disposicion-final",
    nodeType: "disposicion_final",
  },
  {
    match: /DEROGATORIA/,
    scope: "disposicion-derogatoria",
    nodeType: "chapter",
  },
];

export function isDispositionPathScope(value: string): value is DispositionPathScope {
  for (const scope of LEGAL_DISPOSITION_SCOPES) {
    if (scope === value) {
      return true;
    }
  }
  return false;
}

export function legalScopeSegments(
  title: string,
  isSpecial: boolean,
): ReadonlyArray<LegalPathSegment> {
  if (!isSpecial) {
    return [];
  }

  const normalized = normalizeLegalPathSegment(title).toUpperCase();
  const matched = LEGAL_SCOPE_RULES.find((rule) => rule.match.test(normalized));
  if (matched === undefined) {
    return [];
  }

  return [{ _tag: "scope", value: matched.scope }];
}

export function specialSectionNodeType(title: string, isSpecial: boolean): NodeType {
  if (!isSpecial) {
    return "chapter";
  }

  const normalized = normalizeLegalPathSegment(title).toUpperCase();
  const matched = LEGAL_SCOPE_RULES.find((rule) => rule.match.test(normalized));
  return matched?.nodeType ?? "chapter";
}
