// The stored action carries its executor as typed display metadata, lifted from
// the result; malformed or absent values never fail a read. No database.
import { describe, expect, it } from "vitest";
import { toStoredAction } from "./session-reads";

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

describe("stored action sourceSnapshots", () => {
  const withIds = (ids: unknown) => ({ ...row(null), snapshot_event_ids: ids });

  it("lifts snapshot provenance ids to source and event ids, in order", () => {
    const stored = toStoredAction(
      withIds([
        "snap/00000000-0000-4000-8000-0000000000aa/screen/s1",
        "snap/00000000-0000-4000-8000-0000000000aa/screen/s2",
      ]),
    );
    expect(stored.sourceSnapshots).toEqual([
      { sourceId: "screen", eventId: "s1" },
      { sourceId: "screen", eventId: "s2" },
    ]);
    // Only ids: no session id, no content.
    expect(JSON.stringify(stored.sourceSnapshots)).not.toContain("0000aa");
  });

  it("is absent without snapshots, malformed ids or the column", () => {
    expect(toStoredAction(row(null))).not.toHaveProperty("sourceSnapshots");
    expect(toStoredAction(withIds([]))).not.toHaveProperty("sourceSnapshots");
    expect(toStoredAction(withIds(["snap/bad"]))).not.toHaveProperty(
      "sourceSnapshots",
    );
  });
});

describe("stored action noQuestion (D36)", () => {
  it("is derived from the stored category, never stored, and absent otherwise", () => {
    expect(
      toStoredAction(row({ category: "no-question", draft: "x" })).noQuestion,
    ).toBe(true);
    for (const result of [
      { category: "other", draft: "x" },
      { category: "coding" },
      { draft: "x" },
      { withheld: { count: 1 } },
      null,
    ])
      expect(toStoredAction(row(result))).not.toHaveProperty("noQuestion");
  });
});
