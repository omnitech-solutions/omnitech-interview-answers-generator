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

export type WithheldSummary = {
  rejectedClaimCount: number;
  codes: string[];
};

export const INVALID_OUTPUT_REASON = "invalid_output";
const MAX_CODES = 12;
// A code is a lower-case identifier from this codebase's own violation
// vocabulary (claims.ts, assist-stage.ts, zod issue codes). Anything else is
// dropped, so a model-shaped string can never reach the record.
const CODE = /^[a-z][a-z_]{0,39}$/;
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
    if (CODE.test(code)) codes.add(code);
  }
  return {
    rejectedClaimCount: claimIndexes.size,
    codes: [...codes].sort().slice(0, MAX_CODES),
  };
}

// invalid_output.n3.code_a.code_b (codes never contain a dot).
export function encodeWithheldReason(summary: WithheldSummary): string {
  return [
    INVALID_OUTPUT_REASON,
    `n${Math.min(summary.rejectedClaimCount, 999)}`,
    ...summary.codes.filter((code) => CODE.test(code)),
  ].join(".");
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
      codes: codes.filter((code) => CODE.test(code)),
    },
  };
}
