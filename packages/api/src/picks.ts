import type { Provider, Slug } from '@canary/api/catalog.generated';

/**
 * The models Canary offers, picked by hand from everything OpenRouter serves.
 *
 * Only the choice lives here. Names, descriptions, capabilities, limits and
 * prices come from models.dev when `bun run models:generate` writes
 * `catalog.generated.ts`, so they are never typed out by hand and never drift.
 *
 * `id` is checked against every OpenRouter slug models.dev knows, so a typo or
 * a retired model is a type error here, not a failed run. `name` and `blurb`
 * override models.dev where its copy does not tell two models apart.
 * `favorite` seeds the picker's favourites for someone who has not starred
 * anything yet.
 */
type Pick = {
  id: Slug;
  name?: string;
  blurb?: string;
  favorite?: true;
};

const picks = [
  { id: 'anthropic/claude-sonnet-5', favorite: true },
  { id: 'anthropic/claude-opus-5.5', favorite: true },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  {
    id: 'openai/gpt-5.6-sol',
    blurb: 'OpenAI flagship for hard reasoning, coding, and long agent runs',
    favorite: true,
  },
  {
    id: 'openai/gpt-5.6-terra',
    blurb: 'Balanced GPT between the flagship and the fast tier',
  },
  {
    id: 'openai/gpt-5.6-luna',
    blurb: 'Fast, low-cost GPT for chat and high-volume work',
  },
  { id: 'google/gemini-3.8-flash', favorite: true },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
  { id: 'google/gemini-3.5-flash-lite' },
  { id: 'x-ai/grok-4.7' },
  { id: 'moonshotai/kimi-k3', favorite: true },
  { id: 'z-ai/glm-5.3', name: 'GLM 5.3' },
  { id: 'deepseek/deepseek-v4.1-flash' },
  { id: 'deepseek/deepseek-v4-pro' },
  {
    id: 'qwen/qwen3.8-max-0902',
    name: 'Qwen3.8 Max',
    blurb: 'Largest Qwen model for reasoning, documents, and agent work',
  },
  { id: 'qwen/qwen3.8-27b' },
  { id: 'mistralai/mistral-large-2512' },
  { id: 'meta-llama/llama-4-maverick' },
] as const satisfies readonly Pick[];

/** The lab behind a slug: everything before the slash. */
type Prefix<T> = T extends `${infer Lab}/${string}` ? Lab : never;

type Lab = Prefix<(typeof picks)[number]['id']>;

/**
 * How each lab is named and which models.dev logo draws it. Every lab a pick
 * belongs to must be here, and nothing else may be: the `satisfies` checks
 * both ways. `logo` is a models.dev provider id, which is not always the
 * OpenRouter prefix — Qwen's mark is Alibaba's.
 */
const labs = {
  anthropic: { name: 'Anthropic', logo: 'anthropic' },
  openai: { name: 'OpenAI', logo: 'openai' },
  google: { name: 'Google', logo: 'google' },
  'x-ai': { name: 'xAI', logo: 'xai' },
  moonshotai: { name: 'Moonshot', logo: 'moonshotai' },
  'z-ai': { name: 'Z.ai', logo: 'zai' },
  deepseek: { name: 'DeepSeek', logo: 'deepseek' },
  qwen: { name: 'Qwen', logo: 'alibaba' },
  mistralai: { name: 'Mistral', logo: 'mistral' },
  'meta-llama': { name: 'Meta', logo: 'llama' },
} as const satisfies Record<Lab, { name: string; logo: Provider }>;

export { labs, picks };
export type { Lab, Pick };
