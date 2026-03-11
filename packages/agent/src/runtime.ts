export type RuntimeTransport = 'sse' | 'none';

export interface RuntimeOptions<TModel, TTools, TConversation, TLlmInput, TContext = unknown> {
  readonly model: TModel;
  readonly tools: TTools;
  readonly convertToLlm: (conversation: TConversation) => TLlmInput;
  readonly transformContext?: (context: TContext) => TContext;
  readonly transport?: RuntimeTransport;
}

export interface Runtime<TModel, TTools, TConversation, TLlmInput, TContext = unknown> {
  readonly model: TModel;
  readonly tools: TTools;
  readonly convertToLlm: (conversation: TConversation) => TLlmInput;
  readonly transformContext?: (context: TContext) => TContext;
  readonly transport: RuntimeTransport;
}

export function createRuntime<TModel, TTools, TConversation, TLlmInput, TContext = unknown>(
  options: RuntimeOptions<TModel, TTools, TConversation, TLlmInput, TContext>,
): Runtime<TModel, TTools, TConversation, TLlmInput, TContext> {
  return {
    model: options.model,
    tools: options.tools,
    convertToLlm: options.convertToLlm,
    transformContext: options.transformContext,
    transport: options.transport ?? 'sse',
  };
}
