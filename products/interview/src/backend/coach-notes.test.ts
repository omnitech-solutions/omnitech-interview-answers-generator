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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoachNotes, replayCoachNotes } from "./coach-notes";

let directory = "";
let file = "";
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "coach-notes-"));
  file = join(directory, "data", "coach-notes.json");
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

// One line of one spoken piece, as the contract keeps it.
const spoken = (text: string) => ({ segments: [{ text, role: "spoken" }] });
const say = (...lines: string[]) => ({
  kind: "say" as const,
  lines: lines.map((text) => ({ segments: [{ text }] })),
});
// A file as an earlier version of the store left it.
const fileOf = (notes: unknown[]) => {
  mkdirSync(join(directory, "data"), { recursive: true });
  writeFileSync(file, JSON.stringify({ notes }));
};
const earlier = (at: number, extra: object = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${at}`,
  createdAt: `2026-10-08T17:4${at}:00.000Z`,
  title: `From before ${at}`,
  tone: "say",
  points: [],
  links: [],
  ...extra,
});
// The store's answer to a note that was taken (never the stale null).
function taken<T>(response: T | null): T {
  if (response === null) throw new Error("The note was refused as stale.");
  return response;
}

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

  it("starts empty when there is no file, its revision taken from the clock", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_791_481_200_000);
    expect(createCoachNotes(file).get()).toEqual({
      revision: 1_791_481_200_000,
      notes: [],
    });
  });

  it("two stores over the same file never start at the same revision: a window that polled the first redraws for the second", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(5_000);
    const first = createCoachNotes(file);
    first.add({ title: "First" });
    first.add({ title: "Second" });
    expect(first.get().revision).toBe(5_002);
    // The restart: a later moment, and nothing changed yet in the new process.
    clock.mockReturnValue(9_000);
    const second = createCoachNotes(file);
    expect(second.get().revision).toBe(9_000);
    expect(second.get().revision).not.toBe(first.get().revision);
    expect(second.get().notes).toEqual(first.get().notes);
  });

  it("gives a note an id, a time and the schema's defaults, and moves the revision", () => {
    const store = createCoachNotes(file);
    const start = store.get().revision;
    const { revision, notes } = taken(
      store.add({
        title: "  Monolith or service  ",
        points: ["Name the criteria"],
      }),
    );
    expect(revision).toBe(start + 1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Monolith or service",
      tone: "say",
      kind: "direct-answer",
      points: ["Name the criteria"],
      sections: [],
      links: [],
      revision: 1,
      status: "ready",
    });
    expect(notes[0]).not.toHaveProperty("key");
    expect(notes[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(notes[0]?.createdAt ?? ""))).toBe(false);
  });

  it("refuses a note the contract does not allow, and keeps what it had", () => {
    const store = createCoachNotes(file);
    const { revision } = taken(store.add({ title: "First" }));
    expect(() => store.add({ title: "" })).toThrow();
    expect(() =>
      store.add({
        title: "Too long a line",
        sections: [say("a".repeat(241))],
      }),
    ).toThrow();
    expect(store.get().revision).toBe(revision);
    expect(titles(store.get())).toEqual(["First"]);
  });

  it("lists the newest note first", () => {
    const store = createCoachNotes(file);
    store.add({ title: "First" });
    store.add({ title: "Second" });
    expect(titles(taken(store.add({ title: "Third" })))).toEqual([
      "Third",
      "Second",
      "First",
    ]);
  });

  it("a note posted for an earlier moment carries that moment as its time, and nothing else of it", () => {
    const store = createCoachNotes(file);
    const { notes } = taken(
      store.add({ title: "Restored", at: "2026-10-08T17:40:00.000Z" }),
    );
    expect(notes[0]?.createdAt).toBe("2026-10-08T17:40:00.000Z");
    expect(notes[0]).not.toHaveProperty("at");
    expect(notes[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    // What is on disk reads back under the kept-note contract.
    expect(createCoachNotes(file).get().notes).toEqual(notes);
  });

  it("a note with no moment of its own is for now", () => {
    const before = Date.now();
    const { notes } = taken(createCoachNotes(file).add({ title: "Now" }));
    const at = Date.parse(notes[0]?.createdAt ?? "");
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("lists by the moment each note was for, newest first, whatever order they were posted in", () => {
    const store = createCoachNotes(file);
    const start = store.get().revision;
    store.add({ title: "Second asked", at: "2026-10-08T17:42:00.000Z" });
    store.add({ title: "First asked", at: "2026-10-08T17:40:00.000Z" });
    store.add({ title: "Third asked", at: "2026-10-08T17:44:00.000Z" });
    expect(titles(store.get())).toEqual([
      "Third asked",
      "Second asked",
      "First asked",
    ]);
    // A note for now is newer than any restored one.
    expect(titles(taken(store.add({ title: "Now" })))[0]).toBe("Now");
    expect(store.get().revision).toBe(start + 4);
    expect(titles(createCoachNotes(file).get())).toEqual(titles(store.get()));
  });

  it("refuses a moment that is not an ISO time, and keeps what it had", () => {
    const store = createCoachNotes(file);
    const { revision } = taken(store.add({ title: "First" }));
    expect(() => store.add({ title: "Bad", at: "yesterday" })).toThrow();
    expect(titles(store.get())).toEqual(["First"]);
    expect(store.get().revision).toBe(revision);
  });

  it("when full, a note for a moment older than all it holds is the one that falls off", () => {
    const store = createCoachNotes(file);
    for (let at = 1; at <= 200; at += 1) store.add({ title: `Note ${at}` });
    const { notes } = taken(
      store.add({ title: "Long ago", at: "2020-01-01T00:00:00.000Z" }),
    );
    expect(notes).toHaveLength(200);
    expect(titles({ notes })).not.toContain("Long ago");
    expect(notes.at(-1)?.title).toBe("Note 1");
  });

  it("keeps a structured note whole, and reads it back after a restart", () => {
    const store = createCoachNotes(file);
    const sections = [
      {
        kind: "say" as const,
        label: "If pushed",
        lines: [
          {
            segments: [
              { text: "Start from the ", role: "spoken" as const },
              {
                text: "Outbox",
                role: "evidence" as const,
                grounding: "inferred" as const,
              },
            ],
          },
        ],
      },
      {
        kind: "caution" as const,
        lines: [
          { segments: [{ text: "Reads only", role: "caution" as const }] },
        ],
      },
    ];
    const { notes } = taken(
      store.add({
        title: "Consistency",
        kind: "technical",
        heard: "How do you keep two services consistent",
        sections,
        diagram: "flowchart LR\n  A --> B",
        key: "q-consistency",
        revision: 2,
      }),
    );
    expect(notes[0]).toMatchObject({
      kind: "technical",
      heard: "How do you keep two services consistent",
      sections,
      diagram: "flowchart LR\n  A --> B",
      key: "q-consistency",
      revision: 2,
      status: "ready",
    });
    expect(createCoachNotes(file).get().notes).toEqual(notes);
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
    const start = store.get().revision;
    store.add({ title: "First" });
    store.add({ title: "Second" });
    expect(store.clear()).toEqual({ revision: start + 3, notes: [] });
    expect(createCoachNotes(file).get().notes).toEqual([]);
    // Nothing to clear is no change: a page that polls does not redraw.
    expect(store.clear()).toEqual({ revision: start + 3, notes: [] });
  });

  it.each([
    ["is not JSON", "{ not json"],
    ["is JSON of another shape", JSON.stringify({ notes: [{ title: 1 }] })],
    ["has no list of notes", JSON.stringify({ notes: "none" })],
  ])(
    "starts empty when the file %s, and the next note replaces it",
    (_name, content) => {
      mkdirSync(join(directory, "data"));
      writeFileSync(file, content);
      const store = createCoachNotes(file);
      expect(store.get().notes).toEqual([]);
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
    const start = store.get().revision;
    expect(store.get().notes).toEqual([]);
    store.add({ title: "First" });
    expect(titles(taken(store.add({ title: "Second" })))).toEqual([
      "Second",
      "First",
    ]);
    expect(store.get().revision).toBe(start + 2);
    expect(store.clear()).toEqual({ revision: start + 3, notes: [] });
    expect(readFileSync(join(directory, "data"), "utf8")).toBe("in the way");
  });
});

describe("a note with a key, revised over time", () => {
  const first = { title: "Consistency", key: "q-1", sections: [say("One")] };

  it("a higher revision that is ready takes the earlier note's place: same id, same time, same position, new content", () => {
    const store = createCoachNotes(file);
    store.add({ title: "Older", at: "2026-10-08T17:40:00.000Z" });
    const before = taken(
      store.add({ ...first, at: "2026-10-08T17:42:00.000Z" }),
    );
    store.add({ title: "Newer", at: "2026-10-08T17:44:00.000Z" });
    const after = taken(
      store.add({
        title: "Consistency, better",
        key: "q-1",
        revision: 2,
        kind: "technical",
        sections: [say("Two")],
        // The moment given with a revision is not the note's: it keeps its own.
        at: "2026-10-08T17:59:00.000Z",
      }),
    );
    expect(titles(after)).toEqual(["Newer", "Consistency, better", "Older"]);
    expect(after.notes[1]).toEqual({
      ...before.notes[0],
      title: "Consistency, better",
      kind: "technical",
      revision: 2,
      sections: [{ kind: "say", lines: [spoken("Two")] }],
    });
    expect(after.revision).toBe(before.revision + 2);
    expect(createCoachNotes(file).get().notes).toEqual(after.notes);
  });

  it("the ready revision is the whole note: what it does not say is gone", () => {
    const store = createCoachNotes(file);
    store.add({
      ...first,
      heard: "How do you keep them consistent",
      diagram: "flowchart LR",
      points: ["A point"],
    });
    const { notes } = taken(
      store.add({ title: "Consistency", key: "q-1", revision: 2 }),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ points: [], sections: [], revision: 2 });
    expect(notes[0]).not.toHaveProperty("heard");
    expect(notes[0]).not.toHaveProperty("diagram");
  });

  it.each([
    ["an older revision", 3, 2],
    ["the same revision again, when the held note is ready", 3, 3],
    ["the first revision again, by default", 1, undefined],
  ])(
    "refuses %s: null, and nothing changes in memory or on disk",
    (_name, held, posted) => {
      const store = createCoachNotes(file);
      const before = taken(store.add({ ...first, revision: held }));
      const onDisk = readFileSync(file, "utf8");
      expect(
        store.add({
          title: "Late",
          key: "q-1",
          sections: [say("Late")],
          ...(posted === undefined ? {} : { revision: posted }),
        }),
      ).toBeNull();
      // A stale revision is refused whether it is ready or still being prepared.
      expect(
        store.add({
          title: "Late",
          key: "q-1",
          status: "pending",
          ...(posted === undefined ? {} : { revision: posted }),
        }),
      ).toBeNull();
      expect(store.get()).toEqual(before);
      expect(readFileSync(file, "utf8")).toBe(onDisk);
    },
  );

  it("revisions that arrive out of order: the newest stays, whichever came last", () => {
    const store = createCoachNotes(file);
    const post = (revision: number) =>
      store.add({
        title: `Revision ${revision}`,
        key: "q-1",
        revision,
        sections: [say(`Line ${revision}`)],
      });
    expect(post(2)).not.toBeNull();
    expect(post(5)).not.toBeNull();
    const settled = store.get();
    for (const late of [3, 1, 4, 5]) expect(post(late)).toBeNull();
    expect(store.get()).toEqual(settled);
    expect(settled.notes).toHaveLength(1);
    expect(settled.notes[0]).toMatchObject({
      title: "Revision 5",
      revision: 5,
    });
    // A newer one still lands after all the refusals.
    expect(titles(taken(post(6)))).toEqual(["Revision 6"]);
    expect(store.get().revision).toBe(settled.revision + 1);
  });

  it("a revision being prepared keeps what is on show and marks it pending at the new revision", () => {
    const store = createCoachNotes(file);
    const before = taken(store.add({ ...first, heard: "As it was heard" }));
    const pending = taken(
      store.add({
        // Nothing of a pending post but its revision is kept.
        title: "Not shown yet",
        key: "q-1",
        revision: 2,
        status: "pending",
        kind: "closing",
        sections: [say("Not shown yet")],
      }),
    );
    expect(pending.notes).toEqual([
      { ...before.notes[0], status: "pending", revision: 2 },
    ]);
    expect(pending.revision).toBe(before.revision + 1);
    expect(createCoachNotes(file).get().notes).toEqual(pending.notes);
  });

  it("pending, then ready at the same revision: the ready one completes it in place", () => {
    const store = createCoachNotes(file);
    const before = taken(store.add(first));
    store.add({ title: "Any", key: "q-1", revision: 2, status: "pending" });
    const ready = taken(
      store.add({
        title: "Consistency, revised",
        key: "q-1",
        revision: 2,
        sections: [say("Two")],
      }),
    );
    expect(ready.notes).toEqual([
      {
        ...before.notes[0],
        title: "Consistency, revised",
        revision: 2,
        status: "ready",
        sections: [{ kind: "say", lines: [spoken("Two")] }],
      },
    ]);
    // Once ready, the same revision again is stale.
    expect(store.add({ title: "Again", key: "q-1", revision: 2 })).toBeNull();
  });

  it("pending again at the same or a higher revision stays pending with the content on show; a lower one is refused", () => {
    const store = createCoachNotes(file);
    store.add(first);
    const pend = (revision: number) =>
      store.add({ title: "Any", key: "q-1", revision, status: "pending" });
    expect(taken(pend(2)).notes[0]).toMatchObject({
      status: "pending",
      revision: 2,
    });
    expect(taken(pend(2)).notes[0]).toMatchObject({
      status: "pending",
      revision: 2,
    });
    expect(taken(pend(4)).notes[0]).toMatchObject({
      title: "Consistency",
      status: "pending",
      revision: 4,
      sections: [{ kind: "say", lines: [spoken("One")] }],
    });
    expect(pend(3)).toBeNull();
    // The ready answer to an overtaken revision is refused too.
    expect(store.add({ title: "Slow", key: "q-1", revision: 3 })).toBeNull();
  });

  it("a first post that is pending is a note with nothing to show yet, completed by its ready revision", () => {
    const store = createCoachNotes(file);
    const pending = taken(
      store.add({ title: "Consistency", key: "q-1", status: "pending" }),
    );
    expect(pending.notes[0]).toMatchObject({
      status: "pending",
      revision: 1,
      sections: [],
    });
    const ready = taken(store.add({ ...first, revision: 1 }));
    expect(ready.notes).toHaveLength(1);
    expect(ready.notes[0]).toMatchObject({
      id: pending.notes[0]?.id,
      status: "ready",
      sections: [{ kind: "say", lines: [spoken("One")] }],
    });
  });

  it("notes with other keys, or with none, are separate notes: nothing is revised or refused", () => {
    const store = createCoachNotes(file);
    store.add({ ...first, revision: 5 });
    expect(store.add({ title: "Other", key: "q-2" })).not.toBeNull();
    expect(store.add({ title: "No key" })).not.toBeNull();
    expect(store.add({ title: "No key" })).not.toBeNull();
    expect(store.get().notes).toHaveLength(4);
  });

  it("a revision is matched to a note read back from the file", () => {
    createCoachNotes(file).add({ ...first, revision: 2 });
    const restarted = createCoachNotes(file);
    expect(restarted.add({ ...first, revision: 2 })).toBeNull();
    expect(
      taken(restarted.add({ ...first, title: "After", revision: 3 })).notes,
    ).toEqual([expect.objectContaining({ title: "After", revision: 3 })]);
  });
});

describe("a file kept in an earlier shape", () => {
  const read = () => createCoachNotes(file).get().notes;

  it("a note from before notes had a structure is a ready direct answer at revision 1, with no sections", () => {
    fileOf([earlier(1, { points: ["Name the criteria"] })]);
    expect(read()).toEqual([
      {
        ...earlier(1, { points: ["Name the criteria"] }),
        kind: "direct-answer",
        sections: [],
        revision: 1,
        status: "ready",
      },
    ]);
  });

  it.each([
    ["answer", "direct-answer"],
    ["close", "closing"],
    ["steer", "follow-up"],
    ["ask-them", "direct-answer"],
    ["follow-up", "follow-up"],
    ["technical", "technical"],
  ])("an earlier kind %s reads as %s", (kind, expected) => {
    fileOf([earlier(1, { kind })]);
    expect(read().map((note) => note.kind)).toEqual([expected]);
  });

  it("a section of labelled points is a say section under that label, each point a line with its bold as evidence", () => {
    fileOf([
      earlier(1, {
        kind: "answer",
        sections: [
          {
            label: "If pushed",
            points: ["Start from the **Outbox** pattern", "**Saga** next"],
          },
          { label: "Proof", points: ["One transaction"] },
        ],
      }),
    ]);
    expect(read()[0]?.sections).toEqual([
      {
        kind: "say",
        label: "If pushed",
        lines: [
          {
            segments: [
              { text: "Start from the ", role: "spoken" },
              { text: "Outbox", role: "evidence" },
              { text: " pattern", role: "spoken" },
            ],
          },
          {
            segments: [
              { text: "Saga", role: "evidence" },
              { text: " next", role: "spoken" },
            ],
          },
        ],
      },
      { kind: "say", label: "Proof", lines: [spoken("One transaction")] },
    ]);
  });

  it("a steer is a caution section after the others: what is off, then the line back", () => {
    fileOf([
      earlier(1, {
        kind: "steer",
        sections: [{ label: "Say", points: ["Lead with the result"] }],
        steer: { issue: "That covers **reads** only", say: "For writes" },
      }),
      earlier(2, { steer: { issue: "Slow down" } }),
    ]);
    const [both, alone] = read();
    expect(both).not.toHaveProperty("steer");
    expect(both?.sections).toEqual([
      { kind: "say", label: "Say", lines: [spoken("Lead with the result")] },
      {
        kind: "caution",
        lines: [
          {
            segments: [
              { text: "That covers ", role: "spoken" },
              { text: "reads", role: "evidence" },
              { text: " only", role: "spoken" },
            ],
          },
          spoken("For writes"),
        ],
      },
    ]);
    expect(alone?.sections).toEqual([
      { kind: "caution", lines: [spoken("Slow down")] },
    ]);
  });

  it("what the interviewer wanted is dropped, and the rest of the note is kept", () => {
    fileOf([
      earlier(1, {
        wants: "A decision rule",
        heard: "When would you split it",
        ask: "Splitting services",
        askId: "q-split",
        markdown: "Say **this**",
        diagram: "flowchart LR",
        tone: "watch",
        links: [{ label: "Docs", url: "https://example.com/" }],
      }),
    ]);
    const [note] = read();
    expect(note).not.toHaveProperty("wants");
    expect(note).toMatchObject({
      heard: "When would you split it",
      ask: "Splitting services",
      askId: "q-split",
      markdown: "Say **this**",
      diagram: "flowchart LR",
      tone: "watch",
      links: [{ label: "Docs", url: "https://example.com/" }],
    });
  });

  it("keeps at most four sections: a steer after four earlier sections is the one left out", () => {
    fileOf([
      earlier(1, {
        sections: ["A", "B", "C", "D"].map((label) => ({
          label,
          points: ["P"],
        })),
        steer: { issue: "Slow down" },
      }),
    ]);
    expect(read()[0]?.sections.map((section) => section.label)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("a note already in today's shape is read as it is", () => {
    const store = createCoachNotes(file);
    const { notes } = taken(
      store.add({
        title: "Today",
        kind: "behavioral",
        key: "q-1",
        revision: 3,
        status: "pending",
        sections: [
          {
            kind: "anchors",
            lines: [
              {
                segments: [
                  { text: "Acme", role: "evidence", grounding: "verified" },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(read()).toEqual(notes);
  });

  it("a note that still does not fit is left out by itself: the ones beside it are read", () => {
    fileOf([
      earlier(1),
      { title: 1 },
      null,
      "a note",
      7,
      earlier(2, { kind: "aside" }),
      earlier(3, { id: "note-3" }),
      // A point that is only bold marks leaves a line with nothing in it.
      earlier(4, { sections: [{ label: "Say", points: ["****"] }] }),
      earlier(5, { sections: [{ label: "a".repeat(25), points: ["P"] }] }),
      earlier(6, { html: "<b>bold</b>" }),
      earlier(7, { kind: "close" }),
    ]);
    expect(titles({ notes: read() })).toEqual([
      "From before 1",
      "From before 7",
    ]);
  });

  it("the next change writes the file in today's shape, without the notes that were left out", () => {
    fileOf([
      earlier(1, {
        kind: "answer",
        wants: "A rule",
        sections: [{ label: "Say", points: ["Lead"] }],
      }),
      { title: 1 },
    ]);
    const store = createCoachNotes(file);
    store.add({ title: "New" });
    const kept = JSON.parse(readFileSync(file, "utf8")).notes;
    expect(kept).toHaveLength(2);
    expect(kept[1]).toMatchObject({
      title: "From before 1",
      kind: "direct-answer",
      sections: [{ kind: "say", label: "Say", lines: [spoken("Lead")] }],
    });
    expect(kept[1]).not.toHaveProperty("wants");
  });
});

describe("notes with no file: the notes of a replay", () => {
  it("are held like any others: added newest first, revised by key, refused when stale, cleared", () => {
    vi.spyOn(Date, "now").mockReturnValue(7_000);
    const store = createCoachNotes(null);
    expect(store.get()).toEqual({ revision: 7_000, notes: [] });
    store.add({ title: "First", at: "2026-10-08T09:00:00.000Z" });
    const second = taken(
      store.add({
        title: "Second",
        key: "q-2",
        at: "2026-10-08T09:01:00.000Z",
      }),
    );
    expect(titles(second)).toEqual(["Second", "First"]);
    expect(second.revision).toBe(7_002);
    const revised = taken(
      store.add({ title: "Second, revised", key: "q-2", revision: 2 }),
    );
    expect(titles(revised)).toEqual(["Second, revised", "First"]);
    expect(revised.notes[0]?.id).toBe(second.notes[0]?.id);
    expect(store.add({ title: "Stale", key: "q-2", revision: 1 })).toBeNull();
    expect(store.clear()).toEqual({ revision: 7_004, notes: [] });
    expect(store.clear()).toEqual({ revision: 7_004, notes: [] });
  });

  it("are in this process only: a new store holds none of them, and nothing is written", () => {
    const before = readdirSync(directory);
    const store = createCoachNotes(null);
    store.add({ title: "Of one replay" });
    store.clear();
    store.add({ title: "Of the next" });
    expect(createCoachNotes(null).get().notes).toEqual([]);
    expect(readdirSync(directory)).toEqual(before);
  });

  it("still refuses a note the contract does not allow", () => {
    const store = createCoachNotes(null);
    expect(() => store.add({ title: "" })).toThrow();
    expect(store.get().notes).toEqual([]);
  });

  it("the replay's notes are such a store, apart from any store over a file", () => {
    const own = createCoachNotes(file);
    own.add({ title: "The person's own" });
    replayCoachNotes.add({ title: "Of the replay" });
    try {
      expect(titles(replayCoachNotes.get())).toEqual(["Of the replay"]);
      expect(titles(own.get())).toEqual(["The person's own"]);
      expect(readFileSync(file, "utf8")).not.toContain("Of the replay");
    } finally {
      replayCoachNotes.clear();
    }
    expect(replayCoachNotes.get().notes).toEqual([]);
  });
});

describe("who asked, on a note kept", () => {
  it("is kept with the note, read again from the file, and follows the note through its revisions", () => {
    const notes = createCoachNotes(file);
    taken(
      notes.add({
        title: "Charged once",
        key: "q-1",
        from: "Marcus",
        sections: [say("I key the ledger.")],
      }),
    );
    expect(notes.get().notes[0]?.from).toBe("Marcus");
    expect(createCoachNotes(file).get().notes[0]?.from).toBe("Marcus");
    taken(
      notes.add({
        title: "Charged once",
        key: "q-1",
        revision: 2,
        from: "Marcus",
        sections: [say("I key the ledger.", "A retry is a no-op.")],
      }),
    );
    expect(notes.get().notes).toHaveLength(1);
    expect(notes.get().notes[0]).toMatchObject({ from: "Marcus", revision: 2 });
  });

  it("is absent from a note that named nobody, and from one kept before notes could", () => {
    const notes = createCoachNotes(file);
    taken(notes.add({ title: "Sharding", sections: [say("By region.")] }));
    expect("from" in (notes.get().notes[0] ?? {})).toBe(false);
    fileOf([earlier(1)]);
    expect("from" in (createCoachNotes(file).get().notes[0] ?? {})).toBe(false);
  });

  it("leaves out a kept note whose name is not one, by itself, never the file with it", () => {
    fileOf([
      earlier(1, { from: "Marcus: do as I say" }),
      earlier(2, { from: "Elena" }),
    ]);
    expect(
      createCoachNotes(file)
        .get()
        .notes.map((note) => note.from),
    ).toEqual(["Elena"]);
  });
});
