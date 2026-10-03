// The companion's only thrown error. The message IS the code, so nothing a
// caller passed (a credential, transcript text, a URL) can ride along in an
// error (rule:credential-storage, rule:id-only-traces).
export type CompanionErrorCode =
  | "invalid_message"
  | "credential_malformed"
  | "invalid_endpoint"
  | "invalid_tenant_slug"
  | "invalid_speed"
  | "clock_deadlock";

export class CompanionError extends Error {
  readonly code: CompanionErrorCode;
  constructor(code: CompanionErrorCode) {
    super(code);
    this.name = "CompanionError";
    this.code = code;
  }
}
