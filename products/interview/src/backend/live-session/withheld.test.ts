// The withheld summary is content-free: a count and codes, nothing the model
// controlled (ADR-0012/id-only-traces).
import { describe, expect, it } from "vitest";
import { SessionError } from "./errors";
import {
  decodeWithheldReason,
  encodeWithheldReason,
  MAX_REASON_CHARS,
  settleWithheld,
  summarizeWithheld,
} from "./withheld";

// The store's own check on a suppression reason (fenced-writes.ts).
const REASON_CODE = new RegExp(`^[a-z0-9_.-]{1,${MAX_REASON_CHARS}}$`);
// The longest real violation codes this codebase raises (claims.ts,
// assist-stage.ts): twelve of them overflow a 200-character reason.
const REAL_CODES = [
  "ungrounded_logistics_figure",
  "missing_element_has_content",
  "missing_reason_placeholder",
  "personal_claim_unsourced",
  "cross_role_references",
  "no_matrix_backed_claim",
  "ungrounded_figure",
  "preference_only_topic",
  "unsupported_reference",
  "too_many_references",
  "unexpected_reference",
  "found_and_missing",
];

describe("withheld reasons the store must accept", () => {
  it("keeps the encoded reason within what the store accepts, however many real codes apply", () => {
    const reason = encodeWithheldReason({
      rejectedClaimCount: 7,
      codes: REAL_CODES,
    });
    expect(reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(REASON_CODE.test(reason)).toBe(true);
    // The count survives; codes are dropped from the end until it fits.
    const decoded = decodeWithheldReason(reason);
    expect(decoded.withheld?.rejectedClaimCount).toBe(7);
    expect(decoded.withheld?.codes.length).toBeGreaterThan(0);
    expect(REAL_CODES).toEqual(
      expect.arrayContaining(decoded.withheld?.codes ?? []),
    );
  });

  it("accepts only codes from the closed violation vocabulary", () => {
    const summary = summarizeWithheld([
      "claims.0:ungrounded_figure",
      // A model-controlled path element can contain a colon and any text.
      "claims.0.refs.zzz_injected_text:another_made_up_code",
      "draft:made_up_code",
      "root:invalid_type",
      "items:unrecognized_keys:3",
    ]);
    expect(summary.codes).toEqual([
      "invalid_type",
      "ungrounded_figure",
      "unrecognized_keys",
    ]);
  });

  it("falls back to the plain reason when the store refuses the encoded one", async () => {
    const written: string[] = [];
    await settleWithheld(
      async (reason) => {
        written.push(reason);
        if (reason !== "invalid_output")
          throw new SessionError("invalid_input");
      },
      "invalid_output",
      { rejectedClaimCount: 2, codes: ["too_big"] },
    );
    expect(written).toEqual(["invalid_output.n2.too_big", "invalid_output"]);
  });

  it("writes a reason without a withheld summary once", async () => {
    const written: string[] = [];
    await settleWithheld(async (r) => void written.push(r), "stage_unlisted");
    expect(written).toEqual(["stage_unlisted"]);
  });
});

describe("summarizeWithheld", () => {
  it("counts distinct rejected claims and lists distinct codes", () => {
    expect(
      summarizeWithheld([
        "claims.0.refs.0:unsupported_reference",
        "claims.0:ungrounded_figure",
        "claims.2.refs:missing_reference",
        "draft:personal_claim_unsourced",
      ]),
    ).toEqual({
      rejectedClaimCount: 2,
      codes: [
        "missing_reference",
        "personal_claim_unsourced",
        "ungrounded_figure",
        "unsupported_reference",
      ],
    });
  });

  it("drops anything that is not a closed-vocabulary code and never copies a path", () => {
    const summary = summarizeWithheld([
      "claims.1:Secret Claim Text",
      "claims.x:too-odd",
      "$:invalid_type",
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/Secret|odd|claims/);
    expect(summary.rejectedClaimCount).toBe(1);
  });

  it("round-trips through the suppression reason and leaves other reasons alone", () => {
    const summary = { rejectedClaimCount: 3, codes: ["too_big", "too_small"] };
    const reason = encodeWithheldReason(summary);
    expect(reason).toBe("invalid_output.n3.too_big.too_small");
    expect(decodeWithheldReason(reason)).toEqual({
      reason: "invalid_output",
      withheld: summary,
    });
    expect(decodeWithheldReason("invalid_output")).toEqual({
      reason: "invalid_output",
      withheld: null,
    });
    expect(decodeWithheldReason("session_paused")).toEqual({
      reason: "session_paused",
      withheld: null,
    });
  });
});
