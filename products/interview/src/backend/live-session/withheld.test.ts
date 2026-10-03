// The withheld summary is content-free: a count and codes, nothing the model
// controlled (ADR-0011 rule:id-only-traces, plan #2 D2).
import { describe, expect, it } from "vitest";
import {
  decodeWithheldReason,
  encodeWithheldReason,
  summarizeWithheld,
} from "./withheld.js";

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
    const summary = { rejectedClaimCount: 3, codes: ["a_code", "b_code"] };
    const reason = encodeWithheldReason(summary);
    expect(reason).toBe("invalid_output.n3.a_code.b_code");
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
