// What a withheld draft leaves behind for the browser (plan #2 D2, ADR-0011
// rule:no-promotion): a CONTENT-FREE record of how many claims verification
// rejected and which violation CODES applied. Never a claim, quote, path
// string, key name or id the model controlled (rule:id-only-traces).
//
// [STRATEGY] session_actions.result is only legal on a succeeded action (the
// "session_actions_result_check" constraint, and the stream contract says the
// same), so the summary rides on the suppression reason, which the database
// already requires for a suppressed action and which the stream mapper
// (toStoredAction) splits back into reason + result.withheld. No migration.
import { SessionError } from "./errors.js";

export type WithheldSummary = {
  rejectedClaimCount: number;
  codes: string[];
};

const INVALID_OUTPUT_REASON = "invalid_output";
// The store refuses a suppression reason longer than this (fenced-writes.ts),
// so the encoded reason is built to fit rather than to be refused.
export const MAX_REASON_CHARS = 200;
const MAX_CODES = 12;
// A code is one of this codebase's own violation codes: the ones claims.ts and
// assist-stage.ts raise, coding-stage.ts's, and zod's issue codes. Anything
// else is dropped, so a model-shaped string (a path element can contain a
// colon) can never reach the record.
const VIOLATION_CODES: ReadonlySet<string> = new Set([
  // claims.ts and assist-stage.ts
  "cross_role_references",
  "disparages_employer",
  "empty",
  "field_mismatch",
  "found_and_missing",
  "generated_reason",
  "missing_element_has_content",
  "missing_reason_placeholder",
  "missing_reference",
  "no_matrix_backed_claim",
  "not_preference_backed",
  "out_of_range",
  "personal_claim_unsourced",
  "pointer_mismatch",
  "preference_only_topic",
  "quote_mismatch",
  "required",
  "spoken_figure",
  "stale_revision",
  "too_many_references",
  "unexpected",
  "unexpected_reference",
  "ungrounded_figure",
  "ungrounded_logistics_figure",
  "unknown_kind",
  "unknown_reference",
  "unsupported_element",
  "unsupported_reference",
  "wrong_source_kind",
  // coding-stage.ts
  "mismatch",
  // zod issue codes
  "custom",
  "invalid_element",
  "invalid_format",
  "invalid_key",
  "invalid_type",
  "invalid_union",
  "invalid_value",
  "not_multiple_of",
  "too_big",
  "too_small",
  "unrecognized_keys",
]);
const isCode = (code: string): boolean => VIOLATION_CODES.has(code);
const CLAIM_PATH = /^claims\.(\d{1,3})(?:\.|$)/;

// [DOMAIN] Violations are "path:code" strings. A claim is rejected when any
// violation path sits under claims.<index>; the count is of distinct indexes.
export function summarizeWithheld(
  violations: readonly string[],
): WithheldSummary {
  const claimIndexes = new Set<string>();
  const codes = new Set<string>();
  for (const violation of violations) {
    const [path = "", code = ""] = violation.split(":");
    const claim = CLAIM_PATH.exec(path);
    if (claim?.[1] !== undefined) claimIndexes.add(claim[1]);
    if (isCode(code)) codes.add(code);
  }
  return {
    rejectedClaimCount: claimIndexes.size,
    codes: [...codes].sort().slice(0, MAX_CODES),
  };
}

// invalid_output.n3.code_a.code_b (codes never contain a dot). Codes are added
// in order while the whole reason stays within MAX_REASON_CHARS; the rest are
// dropped, the rejected-claim count is always kept.
export function encodeWithheldReason(summary: WithheldSummary): string {
  let reason = `${INVALID_OUTPUT_REASON}.n${Math.min(summary.rejectedClaimCount, 999)}`;
  for (const code of summary.codes.filter(isCode)) {
    const next = `${reason}.${code}`;
    if (next.length > MAX_REASON_CHARS) break;
    reason = next;
  }
  return reason;
}

// Settles an action with its withheld reason. A refused write must never leave
// the action in flight, so should the store refuse the encoded reason the plain
// one is written instead.
export async function settleWithheld(
  write: (reason: string) => Promise<unknown>,
  reason: string,
  withheld?: WithheldSummary,
): Promise<void> {
  if (!withheld || reason !== INVALID_OUTPUT_REASON) {
    await write(reason);
    return;
  }
  try {
    await write(encodeWithheldReason(withheld));
  } catch (error) {
    if (!(error instanceof SessionError) || error.code !== "invalid_input")
      throw error;
    await write(reason);
  }
}

export function decodeWithheldReason(reason: string): {
  reason: string;
  withheld: WithheldSummary | null;
} {
  const [head, count, ...codes] = reason.split(".");
  const match = count ? /^n(\d{1,3})$/.exec(count) : null;
  if (head !== INVALID_OUTPUT_REASON || !match?.[1])
    return { reason, withheld: null };
  return {
    reason: INVALID_OUTPUT_REASON,
    withheld: {
      rejectedClaimCount: Number(match[1]),
      codes: codes.filter(isCode),
    },
  };
}
