export type AiSdkErrorCode =
  | "aborted"
  | "configuration"
  | "invalid_output"
  | "provider_failure"
  | "unknown_provider";

export class AiSdkError extends Error {
  constructor(
    readonly code: AiSdkErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiSdkError";
  }
}
