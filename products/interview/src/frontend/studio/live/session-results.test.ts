import { describe, expect, it } from "vitest";
import { CLAIM_PRESENTATION, claimChip, entryLabel } from "./session-claims";
import {
  answerResult,
  codeResult,
  logisticsResult,
  starResult,
} from "./session-result-fixtures";
import {
  parseAgentResult,
  parseAnswerResult,
  parseCodeResult,
  parseDisconnectedContent,
  parseGapContent,
  parseSnapshotContent,
  parseTranscriptContent,
} from "./session-results";

describe("answer results", () => {
  it("reads each claim kind with its references", () => {
    const answer = parseAnswerResult(
      answerResult({
        claims: [
          {
            kind: "matrix-backed",
            text: "a",
            refs: [
              {
                sourceId: "s",
                revision: 3,
                pointer: "/roles/2/company",
                quote: "q",
              },
            ],
          },
          { kind: "preference-backed", text: "b", refs: [] },
          { kind: "suggested-interpretation", text: "c", refs: [] },
          { kind: "general-knowledge", text: "d", refs: [] },
          { kind: "not-in-matrix", text: "e", refs: [] },
        ],
      }),
    );
    expect(answer?.claimCounts).toEqual({
      "matrix-backed": 1,
      "preference-backed": 1,
      "suggested-interpretation": 1,
      "general-knowledge": 1,
      "not-in-matrix": 1,
    });
    expect(answer?.pinned).toEqual({ profileId: "profile-1", revision: 3 });
    const chip = claimChip(answer?.claims[0] as never);
    expect(chip.presentation.label).toBe("From your matrix");
    expect(chip.entries).toEqual([
      { label: "Role 3", revision: 3, quote: "q" },
    ]);
  });

  it("labels the kinds that claim no experience", () => {
    expect(CLAIM_PRESENTATION["suggested-interpretation"]).toMatchObject({
      label: "Suggested framing · not a claim",
      claimsExperience: false,
    });
    expect(CLAIM_PRESENTATION["general-knowledge"].claimsExperience).toBe(
      false,
    );
    expect(CLAIM_PRESENTATION["not-in-matrix"].tone).toBe("red");
    expect(CLAIM_PRESENTATION["matrix-backed"].claimsExperience).toBe(true);
  });

  it("names an entry from its pointer alone", () => {
    expect(entryLabel({ pointer: "/roles/0/summary" })).toBe("Role 1");
    expect(entryLabel({ pointer: "/context/notice/0" })).toBe(
      "Candidate context",
    );
    expect(entryLabel({ pointer: "/elsewhere" })).toBeNull();
  });

  it("reads a STAR outline, dropping out-of-range claim indexes", () => {
    const answer = parseAnswerResult(starResult());
    expect(answer?.star?.map((element) => element.element)).toEqual([
      "situation",
      "task",
      "action",
      "result",
    ]);
    const task = answer?.star?.find((e) => e.element === "task");
    expect(task).toMatchObject({ missing: true, text: "", claims: [] });
    // Claim index 9 does not exist: only the real one remains.
    const action = answer?.star?.find((e) => e.element === "action");
    expect(action?.claims).toHaveLength(1);
  });

  it("reads logistics as found and missing", () => {
    const answer = parseAnswerResult(logisticsResult());
    expect(answer?.logistics?.missing).toEqual(["compensation"]);
    expect(answer?.logistics?.found[0]).toMatchObject({
      field: "notice-period",
      claim: { kind: "preference-backed" },
    });
  });

  it("shows nothing for a malformed or unknown-kind result", () => {
    expect(parseAnswerResult(null)).toBeNull();
    expect(parseAnswerResult("a string")).toBeNull();
    expect(
      parseAnswerResult({ category: "x", draft: 3, claims: [] }),
    ).toBeNull();
    expect(
      parseAnswerResult(
        answerResult({
          claims: [{ kind: "invented-kind", text: "x", refs: [] }],
        }),
      ),
    ).toBeNull();
    // One bad claim voids the answer: no partial guess.
    expect(
      parseAnswerResult(
        answerResult({
          claims: [
            { kind: "general-knowledge", text: "ok", refs: [] },
            { kind: "general-knowledge", refs: [] },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("ignores fields it does not know", () => {
    expect(
      parseAnswerResult({ ...answerResult(), futureField: { deep: true } }),
    ).not.toBeNull();
  });

  it("keeps markup as plain text, to be rendered inertly", () => {
    const answer = parseAnswerResult(
      answerResult({ draft: "<img src=x onerror=alert(1)> **bold**" }),
    );
    expect(answer?.draft).toBe("<img src=x onerror=alert(1)> **bold**");
  });
});

describe("code results", () => {
  it("keeps generated, tests passed and fully verified distinct", () => {
    const code = parseCodeResult(codeResult());
    expect(code?.states).toMatchObject({
      generated: true,
      testsPassed: true,
      fullyVerified: false,
    });
    expect(code?.states.reasons).toEqual(["constraint_uncovered"]);
    expect(code?.tests).toMatchObject({ total: 5, passed: 5 });
    expect(code?.workspace).toMatchObject({
      published: true,
      artifactRevision: 2,
    });
  });

  it("reads a held result with its conflict reason", () => {
    const code = parseCodeResult(
      codeResult({
        workspace: {
          published: false,
          conflict: true,
          reason: "owner_edited",
          expectedRevision: 2,
          foundRevision: 3,
        },
      }),
    );
    expect(code?.workspace).toMatchObject({
      published: false,
      reason: "owner_edited",
      foundRevision: 3,
    });
  });

  it("does not turn a missing runner into a pass", () => {
    const code = parseCodeResult(
      codeResult({
        states: {
          generated: true,
          testsPassed: false,
          fullyVerified: false,
          reasons: ["runner_unavailable"],
        },
        tests: undefined,
        run: {
          available: false,
          exitCode: null,
          timedOut: false,
          durationMs: null,
        },
      }),
    );
    expect(code?.states.testsPassed).toBe(false);
    expect(code?.tests.total).toBe(0);
    expect(code?.runner.available).toBe(false);
  });

  it("shows nothing when the states are missing or malformed", () => {
    expect(parseCodeResult({ ...codeResult(), states: undefined })).toBeNull();
    expect(
      parseCodeResult({ ...codeResult(), states: { generated: "yes" } }),
    ).toBeNull();
    expect(parseCodeResult(42)).toBeNull();
  });

  it("reads an agent job record", () => {
    expect(
      parseAgentResult({
        version: 1,
        agent: { jobRequested: true, kind: "iterative-repair", jobId: "j" },
      }),
    ).toEqual({ jobRequested: true, kind: "iterative-repair" });
    expect(parseAgentResult({})).toBeNull();
  });
});

describe("observation content", () => {
  it("reads each wire kind and rejects the rest", () => {
    expect(
      parseTranscriptContent({
        speaker: "speaker-1",
        text: "Hi",
        startMs: 0,
        endMs: 5,
      }),
    ).toMatchObject({ text: "Hi" });
    expect(parseTranscriptContent({ speaker: "s", text: 5 })).toBeNull();
    expect(
      parseSnapshotContent({
        windowLabel: "Editor",
        mediaType: "image/png",
        byteLength: 3,
      }),
    ).toMatchObject({ windowLabel: "Editor" });
    expect(
      parseDisconnectedContent({ source: "screen", reason: "device-lost" }),
    ).not.toBeNull();
    expect(
      parseDisconnectedContent({ source: "camera", reason: "device-lost" }),
    ).toBeNull();
    expect(
      parseGapContent({
        source: "microphone",
        durationMs: 10,
        reason: "paused",
      }),
    ).not.toBeNull();
    expect(parseGapContent(undefined)).toBeNull();
  });
});
