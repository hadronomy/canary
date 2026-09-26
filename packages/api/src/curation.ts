import type { Provider, Slug } from '@canary/api/catalog.generated';

/**
 * What Canary adds on top of models.dev. The catalog itself is every model
 * OpenRouter serves as models.dev lists it, written by `bun run
 * models:generate`; this file only holds what models.dev cannot know.
 *
 * Every key is typed against the generated unions, so a typo or a model that
 * has since been retired is a type error here rather than a silent no-op.
 */

/** The lab behind a slug: everything before the slash. */
type Prefix<T> = T extends `${infer Lab}/${string}` ? Lab : never;

type LabId = Prefix<Slug>;

/** What the picker starts starred, for someone who has not starred anything. */
const favorites = [
  'anthropic/claude-sonnet-5',
  'anthropic/claude-opus-5.5',
  'openai/gpt-5.6-sol',
  'google/gemini-3.8-flash',
  'moonshotai/kimi-k3',
] as const satisfies readonly Slug[];

/**
 * Copy where models.dev's does not serve the picker: a name carrying a
 * qualifier that means nothing here, or a description shared word for word by
 * models the list needs to tell apart.
 */
const overrides = {
  'anthropic/claude-haiku-4.5': { name: 'Claude Haiku 4.5' },
  'openai/gpt-5.6-sol': {
    blurb: 'OpenAI flagship for hard reasoning, coding, and long agent runs',
  },
  'openai/gpt-5.6-terra': { blurb: 'Balanced GPT between the flagship and the fast tier' },
  'openai/gpt-5.6-luna': { blurb: 'Fast, low-cost GPT for chat and high-volume work' },
  'google/gemini-3.1-pro-preview': { name: 'Gemini 3.1 Pro' },
  'z-ai/glm-5.3': { name: 'GLM 5.3' },
  'qwen/qwen3.8-max-0902': {
    name: 'Qwen3.8 Max',
    blurb: 'Largest Qwen model for reasoning, documents, and agent work',
  },
} as const satisfies Partial<Record<Slug, { name?: string; blurb?: string }>>;

/**
 * Labs drawn with their own mark, in the order the picker's rail lists them.
 * `logo` is the models.dev provider whose logo is the lab's mark, which is not
 * always the OpenRouter prefix: Qwen's is Alibaba's.
 *
 * Only labs with a real mark belong here. models.dev serves a stand-in sparkle
 * for labs it has no logo for, and a borrowed shape is not a lab's mark; those
 * labs are drawn as a monogram and gathered on the rail's last shelf.
 */
const marks = {
  anthropic: { name: 'Anthropic', logo: 'anthropic' },
  openai: { name: 'OpenAI', logo: 'openai' },
  google: { name: 'Google', logo: 'google' },
  'x-ai': { name: 'xAI', logo: 'xai' },
  deepseek: { name: 'DeepSeek', logo: 'deepseek' },
  moonshotai: { name: 'Moonshot', logo: 'moonshotai' },
  'z-ai': { name: 'Z.ai', logo: 'zai' },
  qwen: { name: 'Qwen', logo: 'alibaba' },
  mistralai: { name: 'Mistral', logo: 'mistral' },
  'meta-llama': { name: 'Llama', logo: 'llama' },
  meta: { name: 'Meta', logo: 'meta' },
  minimax: { name: 'MiniMax', logo: 'minimax' },
  cohere: { name: 'Cohere', logo: 'cohere' },
  nvidia: { name: 'Nvidia', logo: 'nvidia' },
  xiaomi: { name: 'Xiaomi', logo: 'xiaomi' },
  inception: { name: 'Inception', logo: 'inception' },
  poolside: { name: 'Poolside', logo: 'poolside' },
  thinkingmachines: { name: 'Thinking Machines', logo: 'thinkingmachines' },
  openrouter: { name: 'OpenRouter', logo: 'openrouter' },
} as const satisfies Partial<Record<LabId, { name: string; logo: Provider }>>;

/**
 * Names for the labs without a mark, where the slug does not read as one.
 * Anything missing here is title-cased from its slug.
 */
const names = {
  'aion-labs': 'Aion Labs',
  'anthracite-org': 'Anthracite',
  'arcee-ai': 'Arcee AI',
  bytedance: 'ByteDance',
  'bytedance-seed': 'ByteDance Seed',
  cognitivecomputations: 'Cognitive Computations',
  'ibm-granite': 'IBM Granite',
  inclusionai: 'inclusionAI',
  'inference-net': 'Inference.net',
  kwaipilot: 'KwaiPilot',
  nousresearch: 'Nous Research',
  'prism-ml': 'Prism ML',
  rekaai: 'Reka AI',
  sakana: 'Sakana AI',
  sao10k: 'Sao10K',
  stepfun: 'StepFun',
  thedrummer: 'TheDrummer',
} as const satisfies Partial<Record<LabId, string>>;

export { favorites, marks, names, overrides };
export type { LabId };
