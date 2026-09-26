import { catalog, labs } from '@canary/api/catalog.generated';

/**
 * The models a person can send a message to, by OpenRouter slug.
 *
 * Plain data with no runtime dependencies, because both sides read it: the
 * API refuses a model that is not listed, and the composer draws its picker
 * from it. It is every model OpenRouter serves, as models.dev lists it, written
 * by `bun run models:generate` with the additions in `curation.ts`; everything
 * here is typed from that output, so a model's id, lab and capabilities are
 * literal types, not strings.
 */
const models = catalog;

type Model = (typeof catalog)[number];
type ModelId = Model['id'];
type Lab = keyof typeof labs;

const ids = models.map((model) => model.id);

/** What a new composer starts on, before anyone has picked. */
const fallback = 'anthropic/claude-sonnet-5' satisfies ModelId;

function isModel(id: string): id is ModelId {
  return models.some((model) => model.id === id);
}

function find(id: string): Model | undefined {
  return models.find((model) => model.id === id);
}

/**
 * How expensive a model is, in four steps, from its output price per million
 * tokens — the side of the bill a long answer runs up. The steps are wide on
 * purpose: they sort models, they are not a quote.
 */
function tier(model: Model): 1 | 2 | 3 | 4 {
  if (model.cost.output <= 2) return 1;
  if (model.cost.output <= 12) return 2;
  if (model.cost.output <= 30) return 3;
  return 4;
}

/** Released in the last six weeks. */
function fresh(model: Model, now: number) {
  return model.released !== null && now - Date.parse(model.released) < 42 * 86_400_000;
}

export { fallback, find, fresh, ids, isModel, labs, models, tier };
export type { Lab, Model, ModelId };
