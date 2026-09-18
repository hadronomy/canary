/**
 * Legal material for the route fallbacks.
 *
 * Real citations rather than invented ones. This is a legal tool, and a fallback
 * that fabricates a norm identifier is worse than a blank page — someone will
 * read it, believe it, and go looking. Every identifier, date and heading below
 * is checkable against boe.es.
 */

type Norm = {
  id: string;
  short: string;
  title: string;
  /** Publication in the gazette, ISO. */
  published: string;
  /** Entry into force, ISO. */
  force: string;
  /** When it stopped being in force, if it has. */
  repealed?: string;
};

const LPAC: Norm = {
  id: 'BOE-A-2015-10565',
  short: 'Ley 39/2015',
  title:
    'Ley 39/2015, de 1 de octubre, del Procedimiento Administrativo Común de las Administraciones Públicas',
  published: '2015-10-02',
  force: '2016-10-02',
};

const LRJPAC: Norm = {
  id: 'BOE-A-1992-26318',
  short: 'Ley 30/1992',
  title:
    'Ley 30/1992, de 26 de noviembre, de Régimen Jurídico de las Administraciones Públicas y del Procedimiento Administrativo Común',
  published: '1992-11-27',
  force: '1993-02-27',
  // Derogada con efectos de 2 de octubre de 2016 por la disposición derogatoria
  // única 2.a) de la Ley 39/2015.
  repealed: '2016-10-02',
};

/** The articles either side of the one that failed, with their real headings. */
const NEIGHBOURS = [
  { n: '19', t: 'Comparecencia de las personas' },
  { n: '20', t: 'Responsabilidad de la tramitación' },
  { n: '21', t: 'Obligación de resolver' },
  { n: '22', t: 'Suspensión del plazo máximo para resolver' },
  { n: '23', t: 'Ampliación del plazo máximo para resolver y notificar' },
  { n: '24', t: 'Silencio administrativo en procedimientos iniciados a solicitud del interesado' },
] as const;

/** Where article 21 sits in the document tree, outermost first. */
const PLACE = ['TÍTULO II', 'CAPÍTULO I', 'Artículo 21'] as const;

/**
 * Article 21, abridged to its operative first paragraphs.
 *
 * Verbatim from the consolidated text so the page reads as the corpus rather
 * than as a mock-up of it.
 */
const ARTICLE = {
  heading: 'Artículo 21. Obligación de resolver.',
  body: [
    '1. La Administración está obligada a dictar resolución expresa y a notificarla en todos los procedimientos cualquiera que sea su forma de iniciación.',
    '2. El plazo máximo en el que debe notificarse la resolución expresa será el fijado por la norma reguladora del correspondiente procedimiento. Este plazo no podrá exceder de seis meses salvo que una norma con rango de Ley establezca uno mayor o así venga previsto en el Derecho de la Unión Europea.',
  ],
} as const;

function iso(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * `2016-10-02` as `2 October 2016`.
 *
 * The interface speaks English and the law is Spanish. Legal terms stay Spanish
 * because they are the corpus' own vocabulary; dates inside English prose are
 * prose, and a Spanish month in the middle of an English sentence reads as a bug.
 */
function spell(date: Date) {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `2016-10-02` as `2 de octubre de 2016`, for text that is itself the record. */
function fecha(date: Date) {
  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function stamp(date: Date) {
  return date.toISOString().slice(0, 10);
}

export { ARTICLE, fecha, iso, LPAC, LRJPAC, NEIGHBOURS, PLACE, spell, stamp };
export type { Norm };
