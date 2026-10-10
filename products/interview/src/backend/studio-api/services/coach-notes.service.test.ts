import { coachNoteInputSchema } from "@omnitech/interview-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({
  notes: { get: vi.fn(), add: vi.fn(), clear: vi.fn() },
  replay: { get: vi.fn(), add: vi.fn(), clear: vi.fn() },
  since: vi.fn(),
  clearTranscript: vi.fn(),
  parseWriter: vi.fn(),
  accepts: vi.fn(),
}));
vi.mock("../../coach-notes", () => ({
  coachNotes: held.notes,
  replayCoachNotes: held.replay,
}));
vi.mock("../../coach-transcript", () => ({
  coachTranscript: { since: held.since, clear: held.clearTranscript },
}));
vi.mock("../../coach-writer", () => ({
  parseWriter: held.parseWriter,
  coachWriters: { accepts: held.accepts },
}));

import { addNote, clearNotes, readNotes } from "./coach-notes.service";

const input = coachNoteInputSchema.parse({
  title: "Consistency",
  kind: "technical",
  key: "q-1",
  sections: [
    {
      kind: "say",
      lines: [{ segments: [{ text: "Start from the outbox" }] }],
    },
  ],
});

beforeEach(() => {
  vi.resetAllMocks();
  held.since.mockReturnValue({ epoch: "current", space: "live" });
  held.parseWriter.mockReturnValue({ id: "coach", epoch: 1 });
  held.accepts.mockReturnValue(true);
});

describe("coach note authorization and ordering", () => {
  it("checks the writer before consulting the transcript or writing notes", () => {
    held.accepts.mockReturnValue(false);
    expect(addNote("live", input, "coach:1", "current")).toEqual({
      kind: "stale_writer",
    });
    expect(held.since).not.toHaveBeenCalled();
    expect(held.notes.add).not.toHaveBeenCalled();
    expect(held.replay.add).not.toHaveBeenCalled();
  });

  it("refuses a malformed claim before looking up the holder", () => {
    held.parseWriter.mockReturnValue(null);
    expect(addNote("live", input, "malformed", undefined)).toEqual({
      kind: "stale_writer",
    });
    expect(held.accepts).not.toHaveBeenCalled();
    expect(held.notes.add).not.toHaveBeenCalled();
  });

  it("refuses a stale conversation before changing a note", () => {
    expect(addNote("live", input, "coach:1", "earlier")).toEqual({
      kind: "stale_conversation",
    });
    expect(held.since).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
    expect(held.notes.add).not.toHaveBeenCalled();
  });

  it.each(["live", "replay"] as const)(
    "accepts an unclaimed note into %s",
    (space) => {
      const store = space === "live" ? held.notes : held.replay;
      const snapshot = { revision: 12, notes: [] };
      store.add.mockReturnValue(snapshot);
      expect(addNote(space, input, undefined, undefined)).toEqual({
        kind: "added",
        notes: snapshot,
      });
      expect(store.add).toHaveBeenCalledWith(input);
      expect(held.parseWriter).not.toHaveBeenCalled();
      expect(held.since).not.toHaveBeenCalled();
    },
  );

  it("reports the existing store's stale revision refusal", () => {
    held.notes.add.mockReturnValue(null);
    expect(addNote("live", input, undefined, "current")).toEqual({
      kind: "stale_coach_note",
    });
  });
});

describe("coach note reads and clearing", () => {
  it("answers an unchanged revision without a snapshot", () => {
    const snapshot = { revision: 12, notes: [] };
    held.notes.get.mockReturnValue(snapshot);
    expect(readNotes("live", "12")).toBeNull();
    expect(readNotes("live", "012")).toBe(snapshot);
    expect(held.replay.get).not.toHaveBeenCalled();
  });

  it("reads replay notes from their separate store", () => {
    const snapshot = { revision: 12, notes: [] };
    held.replay.get.mockReturnValue(snapshot);
    expect(readNotes("replay", undefined)).toBe(snapshot);
    expect(held.notes.get).not.toHaveBeenCalled();
  });

  it.each(["live", "replay"] as const)(
    "clears a matching %s transcript before its notes",
    (space) => {
      held.since.mockReturnValue({ epoch: "current", space });
      const store = space === "live" ? held.notes : held.replay;
      store.clear.mockImplementation(() => {
        expect(held.clearTranscript).toHaveBeenCalledOnce();
        return { revision: 13, notes: [] };
      });
      expect(clearNotes(space)).toEqual({ revision: 13, notes: [] });
    },
  );

  it("leaves the live transcript alone when closing replay notes", () => {
    clearNotes("replay");
    expect(held.replay.clear).toHaveBeenCalledOnce();
    expect(held.clearTranscript).not.toHaveBeenCalled();
    expect(held.notes.clear).not.toHaveBeenCalled();
  });
});
