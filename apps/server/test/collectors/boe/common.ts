import { Effect } from "effect";

import { BoeXmlParser } from "~/collectors/boe/parser";

export const boeParserMetadata = {
  identifier: "BOE-A-TEST-1",
  title: "Documento de prueba",
  department: "Ministerio de Pruebas",
  documentType: "Resolucion",
  publicationDate: "20240101",
  pdfUrl: "https://www.boe.es/test.pdf",
  eliUrl: "https://www.boe.es/eli/test",
  rangoCodigo: "1370",
  seccion: "2",
  subseccion: "A",
} as const;

export function readBoeFixture(name: string): Promise<string> {
  const file = Bun.file(new URL(`../../fixtures/boe/${name}`, import.meta.url));
  return file.text();
}

export function parseBoeFragments(xml: string) {
  return Effect.runPromise(
    BoeXmlParser.parseToFragments({ xml }).pipe(Effect.provide(BoeXmlParser.Default)),
  );
}

export function parseBoeDocument(xml: string) {
  return Effect.runPromise(
    BoeXmlParser.parseDocument({ xml }).pipe(Effect.provide(BoeXmlParser.Default)),
  );
}
