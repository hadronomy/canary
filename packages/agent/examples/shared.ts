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

export const EXAMPLE_ORCHESTRATOR_SERVICE = "agent-orchestrator";

export interface OrchestratorCallOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export interface CreateOrchestratorClientOptions {
  readonly baseUrl: string;
  readonly service?: string;
}

export function createOrchestratorClient(options: CreateOrchestratorClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const service = options.service ?? EXAMPLE_ORCHESTRATOR_SERVICE;

  function toIngressUrl(sessionId: string, handler: string): string {
    return `${baseUrl}/${service}/${encodeURIComponent(sessionId)}/${handler}`;
  }

  return {
    async call<T>(
      sessionId: string,
      handler: string,
      body: unknown,
      callOptions?: OrchestratorCallOptions,
    ): Promise<T> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };

      if (callOptions?.idempotencyKey) {
        headers["idempotency-key"] = callOptions.idempotencyKey;
      }

      const response = await fetch(toIngressUrl(sessionId, handler), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: callOptions?.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Orchestrator ${handler} failed (${response.status}): ${text}`);
      }

      return response.json() as Promise<T>;
    },
  };
}
