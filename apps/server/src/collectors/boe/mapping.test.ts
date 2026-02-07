import { describe, expect, test } from "bun:test";

import { mapBoeLawToDocument, parseBoeDate, parseBoeDateTime } from "./mapping";
import type { BoeLawItem } from "./schemas";

const sampleLaw: BoeLawItem = {
  fecha_actualizacion: "20260206T130329Z",
  identificador: "BOE-A-1989-22056",
  ambito: { codigo: "1", texto: "Estatal" },
  departamento: { codigo: "3120", texto: "Ministerio de Agricultura, Pesca y Alimentacion" },
  rango: { codigo: "1340", texto: "Real Decreto" },
  fecha_disposicion: "19890908",
  numero_oficial: "1095/1989",
  titulo:
    "Real Decreto 1095/1989, de 8 de septiembre, por el que se declaran las especies objeto de caza y pesca.",
  diario: "Boletin Oficial del Estado",
  fecha_publicacion: "19890912",
  diario_numero: "218",
  fecha_vigencia: "19890913",
  vigencia_agotada: "N",
  estado_consolidacion: { codigo: "3", texto: "Finalizado" },
  url_eli: "https://www.boe.es/eli/es/rd/1989/09/08/1095",
  url_html_consolidada: "https://www.boe.es/buscar/act.php?id=BOE-A-1989-22056",
};

describe("boe mapping", () => {
  test("maps BOE payload to legal_documents shape", () => {
    const mapped = mapBoeLawToDocument(sampleLaw, {
      sourceId: "123e4567-e89b-12d3-a456-426614174000",
      actor: "collector:test",
      unknownRangeStrategy: "regulation",
    });

    expect(mapped.canonicalId).toBe("boe:BOE-A-1989-22056");
    expect(mapped.document.contentType).toBe("regulation");
    expect(mapped.document.legislativeStage).toBe("enacted");
    expect(mapped.document.hierarchyLevel).toBe("real_decreto");
    expect(mapped.document.officialTitle).toContain("Real Decreto 1095/1989");
  });

  test("fails on unknown rango with strict strategy", () => {
    const unknownRange: BoeLawItem = {
      ...sampleLaw,
      rango: { codigo: "9999", texto: "Desconocido" },
    };

    expect(() =>
      mapBoeLawToDocument(unknownRange, {
        sourceId: "123e4567-e89b-12d3-a456-426614174000",
        actor: "collector:test",
        unknownRangeStrategy: "fail",
      }),
    ).toThrow("Unsupported BOE rango code");
  });

  test("parses BOE date formats", () => {
    expect(parseBoeDate("20260130").toISOString()).toBe("2026-01-30T00:00:00.000Z");
    expect(parseBoeDateTime("20260130T124315Z").toISOString()).toBe("2026-01-30T12:43:15.000Z");
  });

  test("supports null fecha_vigencia", () => {
    const noVigencia: BoeLawItem = {
      ...sampleLaw,
      identificador: "BOE-A-2025-881",
      fecha_vigencia: null,
    };

    const mapped = mapBoeLawToDocument(noVigencia, {
      sourceId: "123e4567-e89b-12d3-a456-426614174000",
      actor: "collector:test",
      unknownRangeStrategy: "regulation",
    });

    expect(mapped.document.entryIntoForceAt).toBeNull();
  });
});
