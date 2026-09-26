/**
 * Writes `src/catalog.generated.ts` from models.dev.
 *
 *   bun run models:generate   write the catalog
 *   bun run models:check      fail if the committed catalog is out of date
 *
 * Takes every model models.dev lists under OpenRouter that answers in text,
 * can call tools and has a price, and emits them as literal-typed data with their capabilities,
 * limits and prices, grouped by lab and newest first within each lab. What
 * models.dev cannot know — default favourites, copy overrides, which labs have
 * a real mark — comes from `src/curation.ts`. It also emits `Slug` and
 * `Provider`, the unions `curation.ts` is typed against.
 *
 * Left out, because none of them is a separate model to choose: `:free`
 * variants, which are a paid model behind a rate limit; `~` aliases, which
 * point at a model already in the list; and anything without a price. Models
 * that cannot call tools are left out too: the agent keeps working memory,
 * which Mastra runs as a tool call, so a run on one of them cannot start.
 *
 * Anything it cannot vouch for stops the run — a curated model or lab that is
 * no longer listed, a mark that is missing or is not a plain filled path in
 * `currentColor` — and the last good catalog stays in place until it succeeds.
 */
import { favorites, marks, names, overrides } from '../src/curation';

const API = 'https://models.dev/api.json';
const LOGO = (id: string) => `https://models.dev/logos/${id}.svg`;
const OUT = new URL('../src/catalog.generated.ts', import.meta.url);

type Entry = {
  id: string;
  name: string;
  description?: string;
  family?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  open_weights?: boolean;
  release_date?: string;
  knowledge?: string;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number };
};

type Registry = Record<string, { models?: Record<string, Entry> }>;

const task = process.argv.includes('--check') ? 'models:check' : 'models:generate';

function fail(message: string): never {
  console.error(`${task}: ${message}`);
  process.exit(1);
}

const registry = (await fetch(API).then((res) => {
  if (!res.ok) fail(`${API} answered ${res.status}`);
  return res.json();
})) as Registry;

const served = registry.openrouter?.models ?? fail('models.dev has no openrouter provider');

const kept = Object.values(served).filter(
  (entry) =>
    !entry.id.includes(':') &&
    !entry.id.startsWith('~') &&
    (entry.modalities?.output ?? ['text']).includes('text') &&
    entry.tool_call === true &&
    entry.cost?.input !== undefined &&
    entry.cost.output !== undefined,
);

const listed = new Set(kept.map((entry) => entry.id));
for (const id of [...favorites, ...Object.keys(overrides)]) {
  if (!listed.has(id)) fail(`${id} is curated but not in the catalog`);
}

const prefix = (id: string) => id.slice(0, id.indexOf('/'));
const present = new Set(kept.map((entry) => prefix(entry.id)));
for (const lab of Object.keys(marks)) {
  if (!present.has(lab)) fail(`${lab} has a mark but no models`);
}

// Labs with a mark first, in their curated order; then the rest by name.
const title = (slug: string) =>
  slug.replace(
    /(^|[-_])(\w)/g,
    (_, gap: string, letter: string) => `${gap ? ' ' : ''}${letter.toUpperCase()}`,
  );
const called = (lab: string) =>
  (marks as Record<string, { name: string }>)[lab]?.name ??
  (names as Record<string, string>)[lab] ??
  title(lab);
const order = [
  ...Object.keys(marks),
  ...[...present]
    .filter((lab) => !(lab in marks))
    .toSorted((a, b) => called(a).localeCompare(called(b))),
];
const rank = new Map(order.map((lab, index) => [lab, index]));

const models = kept
  .toSorted(
    (a, b) =>
      rank.get(prefix(a.id))! - rank.get(prefix(b.id))! ||
      (b.release_date ?? '').localeCompare(a.release_date ?? '') ||
      a.name.localeCompare(b.name),
  )
  .map((entry) => {
    const own = (overrides as Record<string, { name?: string; blurb?: string }>)[entry.id];
    const inputs = entry.modalities?.input ?? ['text'];

    return {
      id: entry.id,
      name: own?.name ?? entry.name,
      lab: prefix(entry.id),
      blurb: own?.blurb ?? entry.description ?? '',
      favorite: (favorites as readonly string[]).includes(entry.id),
      family: entry.family ?? null,
      released: entry.release_date ?? null,
      knowledge: entry.knowledge ?? null,
      reasoning: entry.reasoning ?? false,
      tools: entry.tool_call ?? false,
      vision: inputs.includes('image'),
      documents: inputs.includes('pdf'),
      open: entry.open_weights ?? false,
      context: entry.limit?.context ?? null,
      output: entry.limit?.output ?? null,
      cost: { input: entry.cost!.input!, output: entry.cost!.output! },
    };
  });

/**
 * A mark as data: its viewBox and the `d` of each path. The picker draws marks
 * in `currentColor`, so anything that is not a plain filled path — a stroke, a
 * gradient, a fixed colour — would draw wrong and is refused.
 */
async function logo(id: string) {
  const res = await fetch(LOGO(id));
  if (!res.ok) fail(`no models.dev logo for ${id} (${res.status})`);
  const svg = await res.text();

  const box = svg.match(/viewBox="([^"]+)"/)?.[1] ?? fail(`${id}.svg has no viewBox`);
  const odd = [...svg.matchAll(/<([a-zA-Z]+)/g)]
    .map((match) => match[1])
    .find((tag) => tag !== 'svg' && tag !== 'path');
  if (odd) fail(`${id}.svg draws a <${odd}>, not only paths`);
  if (/stroke=|fill="(?!currentColor|none)/.test(svg)) {
    fail(`${id}.svg is not a filled currentColor mark`);
  }

  const paths = [...svg.matchAll(/<path\b[^>]*?\sd="([^"]+)"[^>]*>/g)].map((match) => ({
    d: match[1],
    even: /fill-rule="evenodd"/.test(match[0]),
  }));
  if (!paths.length) fail(`${id}.svg has no paths`);

  return { box, paths };
}

const labs = Object.fromEntries(
  await Promise.all(
    order.map(async (lab) => {
      const spec = (marks as Record<string, { logo: string }>)[lab];
      return [lab, { name: called(lab), mark: spec ? await logo(spec.logo) : null }] as const;
    }),
  ),
);

const union = (values: Iterable<string>) =>
  [...new Set(values)]
    .toSorted()
    .map((value) => `  | ${JSON.stringify(value)}`)
    .join('\n');

const source = `// Generated by scripts/models.ts from ${API}. Do not edit by hand:
// change src/curation.ts and run \`bun run models:generate\`.

/** Every model slug OpenRouter serves, as models.dev lists it. */
export type Slug =
${union(Object.keys(served))};

/** Every provider models.dev has a page, and so a logo, for. */
export type Provider =
${union(Object.keys(registry))};

/**
 * Every lab in the catalog, in rail order: labs with a mark first. \`mark\` is
 * null for a lab models.dev has no real logo for.
 */
export const labs = ${JSON.stringify(labs, null, 2)} as const;

/** Every model, grouped by lab in rail order and newest first within each. */
export const catalog = ${JSON.stringify(models, null, 2)} as const;
`;

// The committed file is formatted, so the check formats what it would write the
// same way before comparing: a difference is then a change in the catalog,
// never in whitespace.
if (task === 'models:check') {
  const draft = new URL('../src/catalog.check.ts', import.meta.url);
  await Bun.write(draft, source);
  const format = Bun.spawnSync(['bunx', '--no-install', 'oxfmt', '--write', draft.pathname]);
  const fresh = await Bun.file(draft).text();
  await Bun.file(draft).delete();
  if (format.exitCode !== 0) fail('could not format the catalog to compare it');
  if (fresh !== (await Bun.file(OUT).text())) {
    fail('the catalog is out of date with models.dev. Run `bun run models:generate`.');
  }
  console.log(`models:check: the catalog matches models.dev (${models.length} models).`);
  process.exit(0);
}

await Bun.write(OUT, source);
console.log(
  `models:generate: ${models.length} models from ${order.length} labs, ${Object.keys(marks).length} with a mark.`,
);
