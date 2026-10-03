import { SessionApiError, type SessionErrorCode } from "./session-client";

// What a caught failure is shown as: a fixed code, never a message.
export function errorCodeOf(error: unknown): SessionErrorCode {
  return error instanceof SessionApiError ? error.code : "network";
}

// Answers that retrying cannot change: the session is gone or is not ours.
export const TERMINAL_CODES: readonly SessionErrorCode[] = [
  "not_found",
  "unauthorized",
];
