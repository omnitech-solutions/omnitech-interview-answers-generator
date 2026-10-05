// missingContext: the contract shape, the assist stage keeping a valid draft
// when the field is malformed, the prompt instruction, and the lift onto the
// stored action. No database.
import {
  liveActionSchema,
  liveMissingContextSchema,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { createAssistStage } from "./assist-stage";
import { buildContextSnapshot } from "./context-snapshot";
import { sanitizeMissingContext } from "./missing-context";
import { toStoredAction } from "./session-reads";
import { CANNED_DRAFT } from "./session-replay-fixtures";

const stage = createAssistStage();
const snapshot = buildContextSnapshot({ matrix: null, profile: null });
const validate = (raw: unknown) =>
  stage.validate(raw, { snapshot, captured: [], screenBased: true });

describe("missingContext schema", () => {
  it("accepts closed kinds with optional plain notes", () => {
    expect(
      liveMissingContextSchema.safeParse([
        { kind: "constraints" },
        { kind: "examples", note: "Sample input is not visible" },
      ]).success,
    ).toBe(true);
    expect(liveMissingContextSchema.safeParse([]).success).toBe(true);
  });

  it.each([
    ["unknown kind", [{ kind: "tests" }]],
    ["duplicate kind", [{ kind: "other" }, { kind: "other" }]],
    [
      "too many",
      ["constraints", "examples", "signature", "language", "other"].map(
        (kind) => ({ kind }),
      ),
    ],
    ["long note", [{ kind: "other", note: "x".repeat(121) }]],
    ["control character", [{ kind: "other", note: "a\nb" }]],
    ["format character", [{ kind: "other", note: "a‮b" }]],
    ["extra key", [{ kind: "other", extra: 1 }]],
  ])("rejects %s", (_name, value) => {
    expect(liveMissingContextSchema.safeParse(value).success).toBe(false);
  });

  it("keeps an older action without the field parsing", () => {
    const action = {
      id: "00000000-0000-4000-8000-000000000001",
      taskId: "t",
      taskRevision: 1,
      actionKind: "draft-answer",
      dispatchStatus: "succeeded",
      attempt: 1,
      fenceAtDispatch: 1,
      jobId: null,
      jobCreated: false,
      result: null,
      shown: true,
      suppressionReason: null,
      createdAt: "2026-10-04T00:00:00Z",
      updatedAt: "2026-10-04T00:00:00Z",
    };
    expect(liveActionSchema.safeParse(action).success).toBe(true);
    expect(
      liveActionSchema.safeParse({
        ...action,
        missingContext: [{ kind: "constraints" }],
      }).success,
    ).toBe(true);
  });
});

describe("assist stage missingContext", () => {
  it("publishes a valid missingContext with the draft", () => {
    const result = validate({
      ...CANNED_DRAFT,
      missingContext: [{ kind: "constraints", note: "Limits not visible" }],
    });
    expect(result).toMatchObject({
      ok: true,
      draft: {
        missingContext: [{ kind: "constraints", note: "Limits not visible" }],
      },
    });
  });

  it("keeps the draft and drops only the field when it is malformed", () => {
    for (const bad of [
      "constraints",
      { kind: "constraints" },
      [{ kind: "tests" }],
      [{ kind: "other", note: "x".repeat(500) }],
    ]) {
      const result = validate({ ...CANNED_DRAFT, missingContext: bad });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.draft).not.toHaveProperty("missingContext");
    }
  });

  it("drops only the offending entries", () => {
    const kept = sanitizeMissingContext([
      { kind: "constraints" },
      { kind: "constraints", note: "again" },
      { kind: "bogus" },
      { kind: "examples", note: "bad\u0000" },
      { kind: "signature", note: "Function name is cut off" },
    ]);
    expect(kept).toEqual([
      { kind: "constraints" },
      { kind: "signature", note: "Function name is cut off" },
    ]);
  });

  it("never treats the notes as claims or as a cue for the claim checks", () => {
    const result = validate({
      ...CANNED_DRAFT,
      missingContext: [{ kind: "other", note: "Notice period 90 days salary" }],
    });
    expect(result.ok).toBe(true);
  });

  it("tells the model what to report when it has a screenshot", () => {
    const prepared = stage.prepare({
      taskId: "task-i.r-1",
      revision: 1,
      captured: [],
      context: { snapshot, matrix: null },
      deviceOnly: false,
      imageCount: 1,
    });
    if (!prepared.ok) throw new Error("prompt refused");
    const { system, schema } = prepared.prompt;
    expect(system).toContain("missingContext");
    expect(system).toContain("statement-cut-off");
    expect(system).toContain("Never invent requirements");
    expect((schema as { required: string[] }).required).not.toContain(
      "missingContext",
    );
  });
});

describe("stored action missingContext", () => {
  const row = (result: unknown) => ({
    id: "00000000-0000-4000-8000-000000000001",
    task_id: "t",
    task_revision: 1,
    action_kind: "draft-answer",
    dispatch_status: "succeeded",
    attempt: 1,
    fence_at_dispatch: 1,
    job_id: null,
    job_created: false,
    result,
    shown: true,
    suppression_reason: null,
    created_at: "2026-10-04T00:00:00Z",
    updated_at: "2026-10-04T00:00:00Z",
  });

  it("lifts a valid missingContext from the result", () => {
    const missingContext = [{ kind: "examples", note: "No sample input" }];
    expect(
      toStoredAction(row({ draft: "x", missingContext })).missingContext,
    ).toEqual(missingContext);
  });

  it("omits it for older rows, empty and malformed values", () => {
    for (const result of [
      { draft: "x" },
      null,
      { missingContext: [] },
      { missingContext: "nope" },
      { missingContext: [{ kind: "bogus" }] },
    ])
      expect(toStoredAction(row(result))).not.toHaveProperty("missingContext");
  });
});
