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
    // Text safe to show a person: built only from the provider label, model,
    // failure kind and field paths, never provider messages or content.
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AiSdkError";
  }
}
