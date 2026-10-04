// The stored action carries its executor as typed display metadata, lifted from
// the result; malformed or absent values never fail a read. No database.
import { describe, expect, it } from "vitest";
import { toStoredAction } from "./session-reads.js";

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

describe("stored action generatedBy", () => {
  it("lifts a well-formed generatedBy from the result", () => {
    const generatedBy = { runtime: "claude-code", model: "claude-sonnet-5-5" };
    expect(
      toStoredAction(row({ draft: "x", generatedBy })).generatedBy,
    ).toEqual(generatedBy);
  });

  it("omits it for older rows and malformed values", () => {
    expect(toStoredAction(row({ draft: "x" }))).not.toHaveProperty(
      "generatedBy",
    );
    expect(toStoredAction(row(null))).not.toHaveProperty("generatedBy");
    expect(
      toStoredAction(row({ generatedBy: { runtime: 1 } })),
    ).not.toHaveProperty("generatedBy");
  });
});
