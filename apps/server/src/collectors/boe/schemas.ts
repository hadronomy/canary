import { Schema } from "effect";

const BoeDateSchema = Schema.String.pipe(Schema.pattern(/^\d{8}$/));
const BoeDateTimeSchema = Schema.String.pipe(Schema.pattern(/^\d{8}T\d{6}Z$/));

export const BoeTaxonomyValueSchema = Schema.Struct({
  codigo: Schema.String,
  texto: Schema.String,
});

export const BoeLawItemSchema = Schema.Struct({
  fecha_actualizacion: BoeDateTimeSchema,
  identificador: Schema.String,
  ambito: BoeTaxonomyValueSchema,
  departamento: BoeTaxonomyValueSchema,
  rango: BoeTaxonomyValueSchema,
  fecha_disposicion: BoeDateSchema,
  numero_oficial: Schema.optionalWith(Schema.NullOr(Schema.String), {
    default: () => null,
  }),
  titulo: Schema.String,
  diario: Schema.String,
  fecha_publicacion: BoeDateSchema,
  diario_numero: Schema.String,
  fecha_vigencia: Schema.optionalWith(Schema.NullOr(BoeDateSchema), {
    default: () => null,
  }),
  vigencia_agotada: Schema.Literal("S", "N"),
  estado_consolidacion: BoeTaxonomyValueSchema,
  url_eli: Schema.optionalWith(Schema.NullOr(Schema.String), {
    default: () => null,
  }),
  url_html_consolidada: Schema.String,
  estatus_derogacion: Schema.optional(Schema.Literal("S", "N")),
  estatus_anulacion: Schema.optional(Schema.Literal("S", "N")),
});

const BoeArrayDataSchema = Schema.Struct({
  status: Schema.Struct({
    code: Schema.String,
    text: Schema.String,
  }),
  data: Schema.Array(BoeLawItemSchema),
});

const BoeObjectDataSchema = Schema.Struct({
  status: Schema.Struct({
    code: Schema.String,
    text: Schema.String,
  }),
  data: Schema.Struct({
    item: Schema.Union(BoeLawItemSchema, Schema.Array(BoeLawItemSchema)),
    total: Schema.optional(Schema.Number),
  }),
});

const BoeEmptyDataSchema = Schema.Struct({
  status: Schema.Struct({
    code: Schema.String,
    text: Schema.String,
  }),
  data: Schema.Literal(""),
});

export const BoeResponseSchema = Schema.Union(
  BoeArrayDataSchema,
  BoeObjectDataSchema,
  BoeEmptyDataSchema,
);

export type BoeLawItem = typeof BoeLawItemSchema.Type;
export type BoeResponse = typeof BoeResponseSchema.Type;

type BoeObjectData = Extract<BoeResponse["data"], { readonly item: unknown }>;

const isBoeObjectData = (data: BoeResponse["data"]): data is BoeObjectData => !Array.isArray(data);
const isBoeLawItemArray = (item: BoeObjectData["item"]): item is ReadonlyArray<BoeLawItem> =>
  Array.isArray(item);

export const normalizeBoeItems = (response: BoeResponse): ReadonlyArray<BoeLawItem> => {
  const data = response.data;
  if (typeof data === "string") {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (isBoeObjectData(data)) {
    const item = data.item;
    if (isBoeLawItemArray(item)) {
      return item;
    }

    return [item];
  }

  return [];
};
