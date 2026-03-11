export const TURN_ERROR_STAGE = {
  LLM: 'llm',
  TOOL: 'tool',
  PUBLISH: 'publish',
} as const;

export const TURN_ERROR_CODE = {
  HARNESS_RUN_ERROR: 'HARNESS_RUN_ERROR',
  TOOL_ERROR: 'TOOL_ERROR',
} as const;

export const CLIENT_ERROR_CODE = {
  HARNESS_HTTP_RUN_FAILED: 'HARNESS_HTTP_RUN_FAILED',
  HARNESS_HTTP_SESSION_COMMAND_FAILED: 'HARNESS_HTTP_SESSION_COMMAND_FAILED',
} as const;

export type TurnErrorCode = (typeof TURN_ERROR_CODE)[keyof typeof TURN_ERROR_CODE];

export type ClientErrorCode = (typeof CLIENT_ERROR_CODE)[keyof typeof CLIENT_ERROR_CODE];
