import type { Model } from "@mariozechner/pi-ai";

import { defineAgent, defineAgents, superJsonCodec, toPublicAgentContracts } from "@canary/agent";

export interface SupportAgentInput {
  readonly question: string;
}

export interface SupportAgentOutput {
  readonly answer: string;
}

export interface SupportAgentContext {
  readonly userId: string;
}

export function createExampleAgents(
  model: Model<any>,
  options?: {
    readonly getApiKey?: () => string | undefined;
  },
) {
  return defineAgents({
    supportAgent: defineAgent<
      SupportAgentInput,
      SupportAgentOutput,
      SupportAgentContext,
      string,
      string
    >({
      config: {
        systemPrompt:
          "You are a concise and practical support assistant. Prefer short actionable steps.",
        model,
        getApiKey: options?.getApiKey,
      },
      input: superJsonCodec<SupportAgentInput>(),
      output: superJsonCodec<SupportAgentOutput>(),
      prompt: (input, context) => `User(${context.userId}) asks: ${input.question}`,
      resolveOutput: ({ text }) => ({
        answer: text,
      }),
    }),
  });
}

export function createExampleAgentContracts(model: Model<any>) {
  return toPublicAgentContracts(createExampleAgents(model));
}
