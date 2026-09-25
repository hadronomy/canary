/**
 * The models a person can send a message to, by OpenRouter slug.
 *
 * Plain data with no imports, because both sides read it: the API refuses a
 * model that is not listed here, and the composer draws its picker from it.
 * Adding a model is one entry; the picker, the validation and the run all
 * follow.
 *
 * `lab` picks the mark drawn beside the name. `group` places the model in the
 * picker: the frontier models sit at the top of the menu, the open-weight ones
 * one level down. `note` is the one word that tells two models apart.
 */
const models = [
  {
    id: 'anthropic/claude-sonnet-5',
    name: 'Claude Sonnet 5',
    lab: 'anthropic',
    group: 'frontier',
    note: 'Balanced',
  },
  {
    id: 'anthropic/claude-opus-5.5',
    name: 'Claude Opus 5.5',
    lab: 'anthropic',
    group: 'frontier',
    note: 'Deepest',
  },
  {
    id: 'openai/gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    lab: 'openai',
    group: 'frontier',
    note: 'Flagship',
  },
  {
    id: 'google/gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    lab: 'google',
    group: 'frontier',
    note: 'Fast',
  },
  {
    id: 'moonshotai/kimi-k3',
    name: 'Kimi K3',
    lab: 'moonshot',
    group: 'open',
    note: 'Reasoning',
  },
  {
    id: 'z-ai/glm-5.3',
    name: 'GLM 5.3',
    lab: 'zai',
    group: 'open',
    note: 'Agentic',
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    lab: 'deepseek',
    group: 'open',
    note: 'Cheapest',
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen3.8 27B',
    lab: 'qwen',
    group: 'open',
    note: 'Compact',
  },
  {
    id: 'mistralai/mistral-large-2512',
    name: 'Mistral Large 3',
    lab: 'mistral',
    group: 'open',
    note: 'European',
  },
] as const;

type Model = (typeof models)[number];
type ModelId = Model['id'];
type Lab = Model['lab'];

const ids = models.map((model) => model.id);

/** What a new composer starts on, before anyone has picked. */
const fallback: ModelId = 'anthropic/claude-sonnet-5';

function find(id: string) {
  return models.find((model) => model.id === id);
}

export { fallback, find, ids, models };
export type { Lab, Model, ModelId };
