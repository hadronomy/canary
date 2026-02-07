import type {
  ContentType,
  HierarchyLevel,
  LegislativeStage,
  NewLegalDocument,
} from "@canary/db/schema/legislation";

import type { BoeCollectorConfig } from "./config";
import type { BoeLawItem } from "./schemas";

export interface MappedBoeDocument {
  readonly canonicalId: string;
  readonly document: NewLegalDocument;
  readonly metadataHash: string;
}

interface MappingTables {
  readonly contentTypeByRangoCode: Record<string, ContentType>;
  readonly hierarchyByRangoCode: Partial<Record<string, HierarchyLevel>>;
}

const mappingTables: MappingTables = {
  contentTypeByRangoCode: {
    "1070": "law",
    "1290": "law",
    "1300": "law",
    "1310": "regulation",
    "1320": "regulation",
    "1325": "regulation",
    "1340": "regulation",
    "1350": "regulation",
    "1370": "regulation",
    "1390": "regulation",
    "1450": "law",
    "1470": "regulation",
    "1480": "regulation",
    "1500": "regulation",
    "1510": "regulation",
  },
  hierarchyByRangoCode: {
    "1070": "constitucion",
    "1180": "tratado_internacional",
    "1290": "ley_organica",
    "1300": "ley_estatal",
    "1310": "real_decreto_legislativo",
    "1320": "decreto_ley",
    "1325": "decreto_ley",
    "1340": "real_decreto",
    "1350": "orden_ministerial",
    "1370": "resolucion",
    "1390": "circular",
    "1450": "ley_estatal",
    "1470": "decreto",
    "1480": "decreto",
    "1500": "decreto_ley",
    "1510": "decreto",
  },
};

const datePattern = /^(\d{4})(\d{2})(\d{2})$/;
const dateTimePattern = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

export const parseBoeDate = (value: string): Date => {
  const match = datePattern.exec(value);
  if (match === null) {
    throw new Error(`Invalid BOE date '${value}'`);
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0));
};

export const parseBoeDateTime = (value: string): Date => {
  const match = dateTimePattern.exec(value);
  if (match === null) {
    throw new Error(`Invalid BOE datetime '${value}'`);
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
};

const toLegislativeStage = (item: BoeLawItem): LegislativeStage => {
  if (item.estatus_derogacion === "S") {
    return "repealed";
  }
  if (item.vigencia_agotada === "S") {
    return "expired";
  }
  return "enacted";
};

const toContentType = (
  item: BoeLawItem,
  strategy: BoeCollectorConfig["unknownRangeStrategy"],
): ContentType => {
  const contentType = mappingTables.contentTypeByRangoCode[item.rango.codigo];
  if (contentType !== undefined) {
    return contentType;
  }

  if (strategy === "regulation") {
    return "regulation";
  }

  throw new Error(`Unsupported BOE rango code '${item.rango.codigo}' for '${item.identificador}'`);
};

const toHierarchyLevel = (item: BoeLawItem): HierarchyLevel | null => {
  return mappingTables.hierarchyByRangoCode[item.rango.codigo] ?? null;
};

const normalizeCanonicalId = (identifier: string): string => {
  const canonicalId = `boe:${identifier}`;
  if (canonicalId.length > 150) {
    throw new Error(`Canonical ID too long for '${identifier}'`);
  }
  return canonicalId;
};

const buildBoePdfUrl = (identifier: string, publicationDate: string): string => {
  const year = publicationDate.slice(0, 4);
  const month = publicationDate.slice(4, 6);
  const day = publicationDate.slice(6, 8);
  return `https://www.boe.es/boe/dias/${year}/${month}/${day}/pdfs/${identifier}.pdf`;
};

const buildBoeXmlUrl = (identifier: string): string =>
  `https://www.boe.es/diario_boe/xml.php?id=${identifier}`;

const buildBoeOriginalTextUrl = (identifier: string): string =>
  `https://www.boe.es/diario_boe/txt.php?id=${identifier}`;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const serialized = entries.map(
    ([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`,
  );
  return `{${serialized.join(",")}}`;
};

export const createMetadataHash = (payload: unknown): string => {
  const body = stableStringify(payload);
  return new Bun.CryptoHasher("sha256").update(body).digest("hex");
};

export const mapBoeLawToDocument = (
  law: BoeLawItem,
  options: {
    readonly sourceId: string;
    readonly actor: string;
    readonly unknownRangeStrategy: BoeCollectorConfig["unknownRangeStrategy"];
  },
): MappedBoeDocument => {
  const publishedAt = parseBoeDate(law.fecha_publicacion);
  const updatedAt = parseBoeDateTime(law.fecha_actualizacion);
  const entryIntoForceAt = law.fecha_vigencia === null ? null : parseBoeDate(law.fecha_vigencia);
  const dispositionAt = parseBoeDate(law.fecha_disposicion);
  const canonicalId = normalizeCanonicalId(law.identificador);
  const contentType = toContentType(law, options.unknownRangeStrategy);
  const legislativeStage = toLegislativeStage(law);
  const hierarchyLevel = toHierarchyLevel(law);
  const pdfUrl = buildBoePdfUrl(law.identificador, law.fecha_publicacion);
  const xmlUrl = buildBoeXmlUrl(law.identificador);
  const originalTextUrl = buildBoeOriginalTextUrl(law.identificador);

  const rawMetadata = {
    boe: law,
    links: {
      pdf: pdfUrl,
      xml: xmlUrl,
      originalText: originalTextUrl,
      consolidatedText: law.url_html_consolidada,
    },
    mappedBy: options.actor,
    mappedAt: updatedAt.toISOString(),
    source: {
      provider: "boe",
      endpoint: "legislacion-consolidada",
    },
  };

  const metadataHash = createMetadataHash(rawMetadata);

  return {
    canonicalId,
    metadataHash,
    document: {
      sourceId: options.sourceId,
      canonicalId,
      eliUri: law.url_eli,
      contentType,
      legislativeStage,
      hierarchyLevel,
      officialTitle: law.titulo,
      shortTitle: null,
      acronym: null,
      draftNumber: law.numero_oficial,
      proceduralStatus: law.estado_consolidacion.texto,
      parliamentaryPeriod: null,
      parliamentarySession: null,
      introducedAt: dispositionAt,
      debatedAt: null,
      approvedAt: null,
      publishedAt,
      entryIntoForceAt,
      repealedAt: law.estatus_derogacion === "S" ? updatedAt : null,
      repealedByDocId: null,
      isConsolidatedText: true,
      consolidationDate: updatedAt,
      consolidatesDocId: null,
      parentBulletinId: null,
      bulletinSection: law.diario,
      bulletinPage: law.diario_numero,
      originalTextUrl,
      debateTranscriptUrl: null,
      enactedTextUrl: law.url_html_consolidada,
      pdfUrl,
      xmlUrl,
      rawMetadata,
      department: law.departamento.texto,
      proposerType: null,
      proposerName: law.departamento.texto,
      contentHash: null,
      metadataHash,
      summaryEmbedding: null,
      firstSeenAt: publishedAt,
      lastUpdatedAt: updatedAt,
      createdBy: options.actor,
      updatedBy: options.actor,
      deletedAt: null,
    },
  };
};
