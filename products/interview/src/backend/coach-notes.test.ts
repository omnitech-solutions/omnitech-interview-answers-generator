// The coach's notes on disk: one file in the data directory, read on first
// use, newest first, bounded, cleared on request, and never a reason for a
// note not to reach the window. Each test has its own temporary directory.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoachNotes } from "./coach-notes";

let directory = "";
let file = "";
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "coach-notes-"));
  file = join(directory, "data", "coach-notes.json");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

const titles = (response: { notes: readonly { title: string }[] }) =>
  response.notes.map((note) => note.title);

describe("the coach notes store", () => {
  it("touches no file until it is first used, then reads what the file holds", () => {
    const store = createCoachNotes(file);
    expect(existsSync(join(directory, "data"))).toBe(false);

    // Written after the store was made: a lazy read still finds it.
    const kept = createCoachNotes(file);
    kept.add({ title: "Kept from before" });
    expect(titles(store.get())).toEqual(["Kept from before"]);
  });

  it("starts empty at revision 0 when there is no file", () => {
    expect(createCoachNotes(file).get()).toEqual({ revision: 0, notes: [] });
  });

  it("gives a note an id, a time and the schema's defaults, and moves the revision", () => {
    const store = createCoachNotes(file);
    const { revision, notes } = store.add({
      title: "  Monolith or service  ",
      points: ["Name the criteria"],
    });
    expect(revision).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Monolith or service",
      tone: "say",
      points: ["Name the criteria"],
      links: [],
    });
    expect(notes[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(notes[0]?.createdAt ?? ""))).toBe(false);
  });

  it("refuses a note the contract does not allow, and keeps what it had", () => {
    const store = createCoachNotes(file);
    store.add({ title: "First" });
    expect(() => store.add({ title: "" })).toThrow();
    expect(store.get()).toMatchObject({ revision: 1 });
    expect(titles(store.get())).toEqual(["First"]);
  });

  it("lists the newest note first", () => {
    const store = createCoachNotes(file);
    store.add({ title: "First" });
    store.add({ title: "Second" });
    expect(titles(store.add({ title: "Third" }))).toEqual([
      "Third",
      "Second",
      "First",
    ]);
  });

  it("a note posted for an earlier moment carries that moment as its time, and nothing else of it", () => {
    const store = createCoachNotes(file);
    const { notes } = store.add({
      title: "Restored",
      at: "2026-10-08T17:40:00.000Z",
    });
    expect(notes[0]?.createdAt).toBe("2026-10-08T17:40:00.000Z");
    expect(notes[0]).not.toHaveProperty("at");
    expect(notes[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    // What is on disk reads back under the kept-note contract.
    expect(createCoachNotes(file).get().notes).toEqual(notes);
  });

  it("a note with no moment of its own is for now", () => {
    const before = Date.now();
    const { notes } = createCoachNotes(file).add({ title: "Now" });
    const at = Date.parse(notes[0]?.createdAt ?? "");
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("lists by the moment each note was for, newest first, whatever order they were posted in", () => {
    const store = createCoachNotes(file);
    store.add({ title: "Second asked", at: "2026-10-08T17:42:00.000Z" });
    store.add({ title: "First asked", at: "2026-10-08T17:40:00.000Z" });
    store.add({ title: "Third asked", at: "2026-10-08T17:44:00.000Z" });
    expect(titles(store.get())).toEqual([
      "Third asked",
      "Second asked",
      "First asked",
    ]);
    // A note for now is newer than any restored one.
    expect(titles(store.add({ title: "Now" }))[0]).toBe("Now");
    expect(store.get().revision).toBe(4);
    expect(titles(createCoachNotes(file).get())).toEqual(titles(store.get()));
  });

  it("refuses a moment that is not an ISO time, and keeps what it had", () => {
    const store = createCoachNotes(file);
    store.add({ title: "First" });
    expect(() => store.add({ title: "Bad", at: "yesterday" })).toThrow();
    expect(titles(store.get())).toEqual(["First"]);
    expect(store.get().revision).toBe(1);
  });

  it("when full, a note for a moment older than all it holds is the one that falls off", () => {
    const store = createCoachNotes(file);
    for (let at = 1; at <= 200; at += 1) store.add({ title: `Note ${at}` });
    const { notes } = store.add({
      title: "Long ago",
      at: "2020-01-01T00:00:00.000Z",
    });
    expect(notes).toHaveLength(200);
    expect(titles({ notes })).not.toContain("Long ago");
    expect(notes.at(-1)?.title).toBe("Note 1");
  });

  it("keeps a structured note whole, and reads it back after a restart", () => {
    const store = createCoachNotes(file);
    const { notes } = store.add({
      title: "Consistency",
      kind: "steer",
      heard: "How do you keep two services consistent",
      wants: "A named technique",
      sections: [{ label: "Say", points: ["Start from the **Outbox**"] }],
      steer: { issue: "That covers reads only", say: "For writes, the ledger" },
      diagram: "flowchart LR\n  A --> B",
    });
    expect(notes[0]).toMatchObject({
      kind: "steer",
      heard: "How do you keep two services consistent",
      wants: "A named technique",
      sections: [{ label: "Say", points: ["Start from the **Outbox**"] }],
      steer: { issue: "That covers reads only", say: "For writes, the ledger" },
      diagram: "flowchart LR\n  A --> B",
    });
    expect(createCoachNotes(file).get().notes).toEqual(notes);
  });

  it("reads a file written before notes had a structure: each is an answer with no sections", () => {
    mkdirSync(join(directory, "data"));
    writeFileSync(
      file,
      JSON.stringify({
        notes: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            createdAt: "2026-10-08T17:40:00.000Z",
            title: "From before",
            tone: "say",
            points: ["Name the criteria"],
            links: [],
          },
        ],
      }),
    );
    expect(createCoachNotes(file).get().notes).toEqual([
      expect.objectContaining({
        title: "From before",
        kind: "answer",
        sections: [],
        points: ["Name the criteria"],
      }),
    ]);
  });

  it("keeps the newest 200 notes: the oldest fall off the end", () => {
    const store = createCoachNotes(file);
    for (let at = 1; at <= 201; at += 1) store.add({ title: `Note ${at}` });
    const { notes } = store.get();
    expect(notes).toHaveLength(200);
    expect(notes[0]?.title).toBe("Note 201");
    expect(notes.at(-1)?.title).toBe("Note 2");
    // The file holds the same 200.
    expect(titles(createCoachNotes(file).get())).toEqual(titles({ notes }));
  });

  it("survives a restart: a new store over the same file reads the notes back", () => {
    const first = createCoachNotes(file);
    first.add({
      title: "Consistency",
      tone: "watch",
      markdown: "Say **outbox**",
      links: [{ label: "Outbox", url: "https://example.com/outbox" }],
    });
    first.add({ title: "Newer" });

    const second = createCoachNotes(file);
    expect(second.get().notes).toEqual(first.get().notes);
    // The revision counts this process's changes, not the file's.
    expect(second.get().revision).toBe(0);
  });

  it("writes the whole file in one move and leaves no draft beside it", () => {
    const store = createCoachNotes(file);
    store.add({ title: "First" });
    store.add({ title: "Second" });
    expect(readdirSync(join(directory, "data"))).toEqual(["coach-notes.json"]);
    expect(
      JSON.parse(readFileSync(file, "utf8")).notes.map(
        (note: { title: string }) => note.title,
      ),
    ).toEqual(["Second", "First"]);
  });

  it("clears every note, on disk too, and moves the revision once", () => {
    const store = createCoachNotes(file);
    store.add({ title: "First" });
    store.add({ title: "Second" });
    expect(store.clear()).toEqual({ revision: 3, notes: [] });
    expect(createCoachNotes(file).get().notes).toEqual([]);
    // Nothing to clear is no change: a page that polls does not redraw.
    expect(store.clear()).toEqual({ revision: 3, notes: [] });
  });

  it.each([
    ["is not JSON", "{ not json"],
    ["is JSON of another shape", JSON.stringify({ notes: [{ title: 1 }] })],
  ])(
    "starts empty when the file %s, and the next note replaces it",
    (_name, content) => {
      mkdirSync(join(directory, "data"));
      writeFileSync(file, content);
      const store = createCoachNotes(file);
      expect(store.get()).toEqual({ revision: 0, notes: [] });
      store.add({ title: "After the bad file" });
      expect(titles(createCoachNotes(file).get())).toEqual([
        "After the bad file",
      ]);
    },
  );

  it("holds the notes in memory when the file cannot be written", () => {
    // The data directory's place is taken by a file: nothing can be written
    // under it, and reading it fails too.
    writeFileSync(join(directory, "data"), "in the way");
    const store = createCoachNotes(file);
    expect(store.get().notes).toEqual([]);
    store.add({ title: "First" });
    expect(titles(store.add({ title: "Second" }))).toEqual(["Second", "First"]);
    expect(store.get().revision).toBe(2);
    expect(store.clear()).toEqual({ revision: 3, notes: [] });
    expect(readFileSync(join(directory, "data"), "utf8")).toBe("in the way");
  });
});
