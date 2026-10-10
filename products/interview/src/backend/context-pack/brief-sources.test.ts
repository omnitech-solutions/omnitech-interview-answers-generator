// The interview brief as sources, in code and with no engine: how text is
// cut into records, what each part becomes, what a stage reads, and what may
// leave this machine. Every name and figure is invented.
import { describe, expect, it } from "vitest";
import type { BriefMaterial } from "../brief/repository";
import {
  briefSources,
  PIECE_CHARS,
  piecesOf,
  remoteSources,
  scopeToStage,
  sourceMayLeaveDevice,
  stageOf,
  withStageBrief,
} from "./brief-sources";
import { MATRIX, PROFILE } from "./fixture";
import { linksOf } from "./links";
import { KINDS } from "./recipe";
import { matrixSource } from "./sources";

const stage = (
  ordinal: number,
  over: Partial<BriefMaterial["stages"][number]> = {},
): BriefMaterial["stages"][number] => ({
  id: `00000000-0000-4000-8000-00000000000${ordinal}`,
  ordinal,
  kind: "technical",
  label: `Round ${ordinal}`,
  scheduledAt: null,
  durationMinutes: null,
  format: null,
  notes: null,
  notesCarried: false,
  outcome: null,
  nextSteps: null,
  people: [],
  transcripts: [],
  ...over,
});
const material = (over: Partial<BriefMaterial> = {}): BriefMaterial => ({
  candidacyId: "00000000-0000-4000-8000-0000000000aa",
  stages: [],
  employerSaid: [],
  research: [],
  ...over,
});

describe("text as pieces", () => {
  it("makes a line a piece, drops its bullet or number, and skips blank lines", () => {
    expect(
      piecesOf("- First  point.\n\n2) Second: point\n* Third\n# Heading\n   "),
    ).toEqual([
      { text: "First point.", line: 1, heading: [] },
      { text: "Second: point", line: 3, heading: ["Second"] },
      { text: "Third", line: 4, heading: [] },
      { text: "Heading", line: 5, heading: [] },
    ]);
    expect(piecesOf("")).toEqual([]);
  });

  it("cuts a line too long for a slot at its sentences, each piece keeping the line's heading", () => {
    const sentence = "The adapter owns retries and the ledger owns state.";
    const long = `Idempotency: ${Array.from({ length: 12 }, () => sentence).join(" ")}`;
    const pieces = piecesOf(long);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.text.length).toBeLessThanOrEqual(PIECE_CHARS);
      expect(piece.heading).toEqual(["Idempotency"]);
      expect(piece.line).toBe(1);
    }
    // Nothing is lost between the pieces.
    expect(pieces.map((piece) => piece.text).join(" ")).toBe(long);
  });

  it("cuts a sentence longer than a slot at its words", () => {
    const pieces = piecesOf(
      Array.from({ length: 200 }, () => "word").join(" "),
    );
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces)
      expect(piece.text.length).toBeLessThanOrEqual(PIECE_CHARS);
    expect(pieces.flatMap((piece) => piece.text.split(" "))).toHaveLength(200);
  });
});

describe("what each part becomes", () => {
  it("gives nothing for an application with nothing typed", () => {
    expect(briefSources(material({ stages: [stage(1)] }))).toEqual([]);
  });

  it("changes a source's revision when what it says changes, and no other's", () => {
    const one = material({
      stages: [stage(1, { notes: "Go: the scheduler." })],
      employerSaid: [
        {
          id: "e1",
          said: "Two rounds.",
          saidBy: null,
          channel: null,
          saidOn: null,
          sha256: "0".repeat(64),
        },
      ],
    });
    const two = material({
      ...one,
      stages: [stage(1, { notes: "Go: the scheduler, rewritten." })],
    });
    const [notesA, saidA] = briefSources(one);
    const [notesB, saidB] = briefSources(two);
    expect(notesA?.id).toBe(notesB?.id);
    expect(notesA?.revision).not.toBe(notesB?.revision);
    expect(saidA).toEqual(saidB);
  });

  it("says who told an employer line, how and when, and keeps a line's identity when another is added", () => {
    const entry = {
      id: "e1",
      said: "No AI assistants in live rounds.\nBring ID.",
      saidBy: "Sam",
      channel: "email",
      saidOn: "2026-10-02",
      sha256: "0".repeat(64),
    };
    const [source] = briefSources(material({ employerSaid: [entry] }));
    expect(source?.records?.map((record) => record.fields)).toMatchObject([
      {
        section: "employerSaid",
        saidBy: "Sam",
        channel: "email",
        saidOn: "2026-10-02",
        said: "2026-10-02, Sam (email): No AI assistants in live rounds.",
      },
      { said: "2026-10-02, Sam (email): Bring ID." },
    ]);
    const [longer] = briefSources(
      material({
        employerSaid: [{ ...entry, said: `First of all.\n${entry.said}` }],
      }),
    );
    expect(longer?.records?.map((record) => record.id).slice(1)).toEqual(
      source?.records?.map((record) => record.id),
    );
  });

  it("makes research the employer's side, a passage a record, under its title", () => {
    const [source] = briefSources(
      material({
        research: [
          {
            id: "r1",
            scope: "company",
            title: "Overview",
            origin: "url",
            originRef: "https://example.invalid/a",
            sha256: "0".repeat(64),
            text: "Pricing: per berth.\nFounded in a boatyard.",
            carried: false,
          },
        ],
      }),
    );
    expect(source).toMatchObject({ id: "research:r1", kind: "research" });
    expect(source?.records).toMatchObject([
      {
        kind: KINDS.employerFact,
        text: "Pricing: per berth.",
        fields: {
          section: "research",
          title: "Overview",
          originRef: "https://example.invalid/a",
          heading: ["Pricing"],
        },
        locator: "/research/r1/1",
      },
      { text: "Founded in a boatyard.", locator: "/research/r1/2" },
    ]);
    expect(stageOf(source?.records?.[0] ?? {})).toBeUndefined();
  });
});

describe("what a stage reads", () => {
  const three = briefSources(
    material({
      stages: [1, 2, 3].map((ordinal) =>
        stage(ordinal, { notes: `Go: round ${ordinal}.` }),
      ),
      employerSaid: [
        {
          id: "e1",
          said: "Two rounds.",
          saidBy: null,
          channel: null,
          saidOn: null,
          sha256: "0".repeat(64),
        },
      ],
    }),
  );

  it("reads everything when no stage is named", () => {
    const { sources, left } = scopeToStage(three, undefined);
    expect(sources).toEqual(three);
    expect(left).toEqual([]);
  });

  it("leaves a later stage out, prefers its own over an earlier one, and leaves the application's as it was", () => {
    const { sources, left } = scopeToStage(three, 2);
    expect(left.map((record) => record.text)).toEqual(["Go: round 3."]);
    const records = sources.flatMap((source) => source.records ?? []);
    expect(
      records.map((record) => [record.text, stageOf(record), record.priority]),
    ).toEqual([
      ["Go: round 1.", 1, 13],
      ["Go: round 2.", 2, 23],
      ["Two rounds.", undefined, 2],
    ]);
    // A source with nothing left in scope is not a source.
    expect(sources.map((source) => source.id)).not.toContain(
      three[2]?.id as string,
    );
  });
});

describe("links, made after the scope", () => {
  const base = [matrixSource(MATRIX, PROFILE)];
  const brief = briefSources(
    material({
      stages: [
        stage(1, { notes: "Scheduler: the Harbourline rewrite in Go." }),
        stage(2, {
          notes: "Invoices: Quayside Freight, 42000 invoices per day.",
        }),
      ],
    }),
  );
  const note = (
    sources: readonly { records?: readonly unknown[] }[],
    text: string,
  ) =>
    sources
      .flatMap(
        (source) =>
          (source.records ?? []) as {
            text: string;
            fields?: Readonly<Record<string, unknown>>;
          }[],
      )
      .find((record) => record.text.startsWith(text));

  it("ties a stage's note to the employer it names, and to the achievement whose figure it states", () => {
    const { sources } = withStageBrief(base, brief, 2);
    expect(linksOf(note(sources, "Scheduler") ?? {})?.roles).toEqual([
      "role:harbourline:staff-engineer",
    ]);
    const invoices = linksOf(note(sources, "Invoices") ?? {});
    expect(invoices?.roles).toEqual(["role:quayside-freight:senior-engineer"]);
    expect(invoices?.achievements).toHaveLength(1);
  });

  it("links nothing of a stage that is out of scope", () => {
    const { sources, left } = withStageBrief(base, brief, 1);
    expect(note(sources, "Invoices")).toBeUndefined();
    expect(left.map((record) => record.text)).toEqual([
      "Invoices: Quayside Freight, 42000 invoices per day.",
    ]);
    expect(withStageBrief(base, [], 1)).toEqual({ sources: base, left: [] });
  });
});

describe("what may leave this machine", () => {
  it("is everything but a device-only transcript", () => {
    const sources = briefSources(
      material({
        stages: [
          stage(1, {
            notes: "Go.",
            transcripts: [
              {
                id: "t1",
                title: "Call",
                origin: "recorded",
                capturePolicy: "device-only",
                occurredAt: null,
                sha256: "1".repeat(64),
                text: "Dana: hello there",
              },
              {
                id: "t2",
                title: "Notes",
                origin: "pasted",
                capturePolicy: "permitted-remote",
                occurredAt: null,
                sha256: "2".repeat(64),
                text: "Dana: hello again",
              },
            ],
          }),
        ],
      }),
    );
    expect(sources.map((source) => [source.kind, source.sendable])).toEqual([
      ["candidate-notes", true],
      ["transcript", false],
      ["transcript", true],
    ]);
    expect(remoteSources(sources).withheld).toEqual([
      { id: `stage:${stage(1).id}:transcript:t1`, reason: "device-only" },
    ]);
    expect(sources[1]?.records?.[0]?.fields).toMatchObject({
      deviceOnly: true,
    });
    expect(sourceMayLeaveDevice({ capturePolicy: "device-only" })).toBe(false);
    expect(sourceMayLeaveDevice({ capturePolicy: null })).toBe(true);
  });
});
