import type { LegalDocument } from "~/schema";

export function isDraft(doc: LegalDocument): boolean {
  return ["draft_bill", "draft_proposal", "draft_amendment"].includes(doc.contentType);
}

export function isLaw(doc: LegalDocument): boolean {
  return ["law", "regulation"].includes(doc.contentType) && doc.legislativeStage === "enacted";
}

export function isActive(doc: LegalDocument): boolean {
  return doc.legislativeStage === "enacted" && doc.repealedAt === null;
}

// TODO: Localize legislative status messages for internationalization (i18n) support
export function getLegislativeStatus(doc: LegalDocument): string {
  const status: Record<string, string> = {
    draft: `Borrador (${doc.proceduralStatus || "en preparación"}) - Sin fuerza legal`,
    parliamentary: "En trámite parlamentario",
    bulletin: "Publicado en boletín - Pendiente de BOE",
    enacted: `Vigente${doc.repealedAt ? " (derogado)" : ""}`,
    repealed: "Derogado",
    expired: "Vigencia agotada",
  };
  return status[doc.legislativeStage] || doc.legislativeStage;
}
