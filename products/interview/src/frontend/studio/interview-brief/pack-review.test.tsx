// The Interview form's "Context pack" card over a stubbed client: what is
// read is shown in a person's words, preparing shows how far it is and can be
// stopped, every correction sends exactly one call, and the card shows what
// the server answers with. Every name here is invented.
import type {
  PackReview,
  PackReviewRecord,
} from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsApiError } from "../documents/documents-client";
import { PackReviewSection } from "./pack-review";
import type { PackPrepareProgress } from "./pack-review-client";

const client = vi.hoisted(() => ({
  read: vi.fn(),
  prepare: vi.fn(),
  correct: vi.fn(),
}));
vi.mock("./pack-review-client", () => ({ packReviewClient: client }));

const ID = "22222222-2222-4222-8222-222222222222";
const POSTING = "posting:1";
const RESEARCH = "research:1";

const record = (over: Partial<PackReviewRecord> = {}): PackReviewRecord => ({
  id: "rec-1",
  kind: "employer-requirement",
  text: "Five years of TypeScript in production",
  sourceId: POSTING,
  quote: "5+ years of TypeScript",
  section: "must-have",
  level: "senior",
  ...over,
});
const review = (over: Partial<PackReview> = {}): PackReview => ({
  candidacyId: ID,
  prepared: true,
  recipe: { id: "application", version: "3" },
  current: true,
  profile: { id: "agent/claude-code", label: "Claude Code", onDevice: false },
  counts: [],
  links: [],
  records: [],
  rejected: [],
  holes: [],
  withheld: [],
  gaps: [],
  fit: { requirements: 0, strong: 0, partial: 0, gap: 0, refused: 0 },
  stages: [],
  sources: [
    {
      id: POSTING,
      kind: "posting",
      title: "The posting",
      state: "current",
      extracted: 4,
      readable: true,
    },
  ],
  ...over,
});
const NOT_PREPARED = review({ prepared: false, sources: [] });

const settle = () => act(async () => undefined);
const type = (element: HTMLElement, value: string) =>
  fireEvent.change(element, { target: { value } });
const click = (testId: string, at = 0) =>
  fireEvent.click(screen.getAllByTestId(testId)[at] as HTMLElement);
// A removal asks first: the confirmation is the library's, built into the page.
const confirm = (name: string) =>
  fireEvent.click(
    screen
      .getAllByRole("button", { name })
      .find((button) => !button.hasAttribute("data-testid")) as HTMLElement,
  );
// The long lists are closed until asked for.
const open = (label: string) => fireEvent.click(screen.getByText(label));

async function show(loaded: PackReview = review(), disabled = false) {
  client.read.mockResolvedValueOnce(loaded);
  render(<PackReviewSection candidacyId={ID} disabled={disabled} />);
  await settle();
}
// A preparation the test finishes by hand, with what it was called with.
function preparing() {
  const held: {
    signal?: AbortSignal | undefined;
    onProgress?: ((progress: PackPrepareProgress) => void) | undefined;
    resolve(review: PackReview): void;
    reject(error: unknown): void;
  } = { resolve: () => undefined, reject: () => undefined };
  client.prepare.mockImplementationOnce(
    (_id: string, _input: unknown, options: typeof held) => {
      held.signal = options.signal;
      held.onProgress = options.onProgress;
      return new Promise<PackReview>((resolve, reject) => {
        held.resolve = resolve;
        held.reject = reject;
      });
    },
  );
  return held;
}
const progress = (
  over: Partial<PackPrepareProgress> = {},
): PackPrepareProgress => ({
  t: "progress",
  done: 1,
  total: 4,
  reading: ["The posting", "Glassdoor notes"],
  calls: 3,
  ...over,
});

beforeEach(() => {
  for (const each of Object.values(client)) each.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("reading the context pack", () => {
  it("reads the application's pack once and says what the card is", async () => {
    await show(NOT_PREPARED);
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read).toHaveBeenCalledWith(ID);
    const card = screen.getByTestId("pk-review");
    expect(card).toHaveTextContent("Context pack");
    expect(card).toHaveTextContent(
      "Check it before the coach, a briefing or a document leans on it.",
    );
    expect(card).toHaveAttribute("aria-busy", "false");
  });

  it("says it is being read until the first answer", async () => {
    client.read.mockReturnValueOnce(new Promise(() => undefined));
    render(<PackReviewSection candidacyId={ID} />);
    await settle();
    expect(screen.getByTestId("pk-review")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Reading the context pack…")).toBeInTheDocument();
    expect(screen.queryByTestId("pk-prepare")).not.toBeInTheDocument();
  });

  it("shows a failed first read and nothing else", async () => {
    client.read.mockRejectedValueOnce(new DocumentsApiError("not-found", null));
    render(<PackReviewSection candidacyId={ID} />);
    await settle();
    expect(screen.getByTestId("pk-error")).toHaveTextContent(
      "The context pack could not be read. Try again.",
    );
    expect(screen.queryByTestId("pk-prepare")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pk-state")).not.toBeInTheDocument();
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
  });

  it("says a pack is not prepared yet, and offers to prepare it", async () => {
    await show(NOT_PREPARED);
    expect(screen.getByTestId("pk-state")).toHaveTextContent(
      "Not prepared yet. Until it is, the coach, briefings and documents use your material as it stands.",
    );
    expect(screen.getByTestId("pk-state")).toHaveTextContent(
      "Claude Code: runs off this device",
    );
    expect(screen.getByTestId("pk-prepare")).toHaveTextContent(/^Prepare$/);
    expect(screen.getByTestId("pk-prepare")).toBeEnabled();
  });

  it("says a prepared pack is prepared, by a model on this device", async () => {
    await show(
      review({
        profile: { id: "model/local", label: "Local model", onDevice: true },
      }),
    );
    expect(screen.getByTestId("pk-state")).toHaveTextContent("Prepared.");
    expect(screen.getByTestId("pk-state")).toHaveTextContent(
      "Local model: runs on this device",
    );
    expect(screen.getByTestId("pk-prepare")).toHaveTextContent("Prepare again");
  });

  it("says a pack of an earlier recipe must be prepared again", async () => {
    await show(review({ current: false }));
    expect(screen.getByTestId("pk-state")).toHaveTextContent(
      "Prepared by an earlier version. Prepare again to use it.",
    );
    expect(screen.getByTestId("pk-prepare")).toHaveTextContent("Prepare again");
  });

  it("with no model set up, says so and does not offer to prepare or read again", async () => {
    await show(review({ prepared: false, profile: null }));
    expect(screen.getByTestId("pk-state")).toHaveTextContent(
      "No model is set up to prepare the pack. Everything still works from your material as it stands.",
    );
    expect(screen.getByTestId("pk-prepare")).toBeDisabled();
    open("Sources");
    expect(screen.getByTestId("pk-source")).toHaveTextContent("The posting");
    expect(screen.queryByTestId("pk-source-again")).not.toBeInTheDocument();
  });
});

describe("what the pack holds", () => {
  it("counts each kind in plain words, an unknown kind as itself", async () => {
    await show(
      review({
        counts: [
          {
            kind: "employer-requirement",
            total: 12,
            extracted: 9,
            confirmed: 2,
            edited: 1,
          },
          {
            kind: "candidate-achievement",
            total: 30,
            extracted: 0,
            confirmed: 0,
            edited: 0,
          },
          {
            kind: "stage-question",
            total: 5,
            extracted: 5,
            confirmed: 0,
            edited: 0,
          },
          {
            kind: "something-new",
            total: 1,
            extracted: 0,
            confirmed: 0,
            edited: 0,
          },
        ],
      }),
    );
    const rows = screen.getAllByTestId("pk-count");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Requirements");
    expect(rows[0]).toHaveTextContent("12");
    expect(rows[0]).toHaveTextContent("9 read by a model");
    expect(rows[0]).toHaveTextContent("2 confirmed");
    expect(rows[0]).toHaveTextContent("1 edited");
    expect(rows[1]).toHaveTextContent("Achievements");
    expect(rows[1]).toHaveTextContent("30");
    expect(rows[1]).not.toHaveTextContent("read by a model");
    expect(rows[1]).not.toHaveTextContent("confirmed");
    expect(rows[1]).not.toHaveTextContent("edited");
    expect(rows[2]).toHaveTextContent("Questions asked");
    expect(rows[3]).toHaveTextContent("something-new");
  });

  it("names every kind the pack has in a person's words", async () => {
    const LABELS = {
      "employer-requirement": "Requirements",
      "employer-fact": "Employer facts",
      "prep-note": "Prep notes",
      "candidate-achievement": "Achievements",
      "candidate-role": "Roles",
      "candidate-story": "Stories",
      "candidate-preference": "Preferences",
      "candidate-profile": "Profile",
      "employer-detail": "Employer",
      "stage-question": "Questions asked",
      "stage-answer": "Answers given",
      "employer-signal": "Signals",
      "stage-commitment": "Commitments",
      "transcript-turn": "Transcript turns",
    };
    await show(
      review({
        counts: Object.keys(LABELS).map((kind) => ({
          kind,
          total: 1,
          extracted: 0,
          confirmed: 0,
          edited: 0,
        })),
      }),
    );
    expect(
      screen.getAllByTestId("pk-count").map((row) => row.textContent),
    ).toEqual(Object.values(LABELS).map((label) => `${label}1`));
  });

  it("says how the record fits, and lists the gaps with what is missing", async () => {
    await show(
      review({
        fit: { requirements: 12, strong: 6, partial: 3, gap: 3, refused: 2 },
        gaps: [
          {
            id: "req-7",
            text: "Kafka at scale",
            note: "Nothing in your record names a message broker.",
          },
          { id: "req-9", text: "A security clearance" },
        ],
      }),
    );
    const fit = screen.getByTestId("pk-fit");
    expect(fit).toHaveTextContent(
      "9 of 12 requirements have evidence (6 strong, 3 partial)",
    );
    expect(fit).toHaveTextContent(
      "2 links a model proposed were refused by the pack's rule.",
    );
    expect(fit).toHaveTextContent("Gaps: asked for, and not in your record");
    const gaps = screen.getAllByTestId("pk-gap");
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toHaveTextContent("Kafka at scale");
    expect(gaps[0]).toHaveTextContent(
      "Nothing in your record names a message broker.",
    );
    expect(gaps[1]).toHaveTextContent(/^A security clearance$/);
  });

  it("leaves out the gaps and the refused links when there are none", async () => {
    await show(
      review({
        fit: { requirements: 4, strong: 4, partial: 0, gap: 0, refused: 0 },
      }),
    );
    const fit = screen.getByTestId("pk-fit");
    expect(fit).toHaveTextContent(
      "4 of 4 requirements have evidence (4 strong, 0 partial)",
    );
    expect(fit).not.toHaveTextContent("refused");
    expect(fit).not.toHaveTextContent("Gaps");
  });

  it("shows each stage with what it has, and a stage with nothing as having no material", async () => {
    await show(
      review({
        stages: [
          {
            ordinal: 1,
            label: "Hiring manager",
            notes: 3,
            transcripts: 1,
            extracted: 14,
            empty: false,
          },
          {
            ordinal: 2,
            label: "Technical",
            notes: 0,
            transcripts: 0,
            extracted: 0,
            empty: true,
          },
        ],
      }),
    );
    const stages = screen.getAllByTestId("pk-stage");
    expect(stages[0]).toHaveTextContent("1. Hiring manager");
    expect(stages[0]).toHaveTextContent("3 notes");
    expect(stages[0]).toHaveTextContent("1 transcript");
    expect(stages[0]).toHaveTextContent("14 facts");
    expect(stages[0]).not.toHaveTextContent("No material");
    expect(stages[1]).toHaveTextContent("2. Technical");
    expect(stages[1]).toHaveTextContent("No material");
  });

  it("lists what was kept on this device", async () => {
    await show(
      review({
        withheld: [
          {
            sourceId: "transcript:1",
            title: "Call with Dana",
            reason: "device-only",
          },
        ],
      }),
    );
    const kept = screen.getByTestId("pk-withheld");
    expect(kept).toHaveTextContent("Kept on this device");
    expect(screen.getByTestId("pk-withheld-row")).toHaveTextContent(
      "Call with Dana",
    );
    expect(screen.getByTestId("pk-withheld-row")).toHaveTextContent(
      "not sent to a model that does not run on this device",
    );
  });

  it("lists the parts that could not be read, by their source's title", async () => {
    await show(
      review({
        holes: [
          {
            sourceId: POSTING,
            locator: "lines 40-80",
            reason: "not-extracted",
            failure: "invalid-output",
          },
          { sourceId: "gone:1", reason: "locality", failure: "locality" },
        ],
      }),
    );
    expect(screen.getByTestId("pk-holes")).toHaveTextContent(
      "Parts that could not be read",
    );
    const holes = screen.getAllByTestId("pk-hole");
    expect(holes[0]).toHaveTextContent("The posting");
    expect(holes[0]).toHaveTextContent("lines 40-80");
    expect(holes[0]).toHaveTextContent("invalid-output");
    // A source the review no longer lists is named by its id.
    expect(holes[1]).toHaveTextContent("gone:1");
    expect(holes[1]).toHaveTextContent("locality");
  });

  it("leaves out the groups that have nothing in them", async () => {
    await show();
    for (const absent of [
      "pk-counts",
      "pk-fit",
      "pk-stages",
      "pk-withheld",
      "pk-holes",
      "pk-error",
      "pk-notice",
      "pk-stats",
    ])
      expect(screen.queryByTestId(absent)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Refused: the source does not say this"),
    ).not.toBeInTheDocument();
  });

  it("lists what was refused, each with its reason", async () => {
    await show(
      review({
        rejected: [
          {
            sourceId: POSTING,
            kind: "employer-requirement",
            text: "Ten years of Rust",
            code: "quote-not-found",
            reason: "The quote is not in the source.",
          },
          { sourceId: POSTING, reason: "It had no text." },
        ],
      }),
    );
    open("Refused: the source does not say this");
    const rows = screen.getAllByTestId("pk-rejected");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ten years of Rust");
    expect(rows[0]).toHaveTextContent("Requirements");
    expect(rows[0]).toHaveTextContent("The quote is not in the source.");
    expect(rows[1]).toHaveTextContent("(no text)");
    expect(rows[1]).toHaveTextContent("It had no text.");
  });

  it("lists each source with its state in plain words", async () => {
    const source = (
      id: string,
      state: PackReview["sources"][number]["state"],
      more: Partial<PackReview["sources"][number]> = {},
    ) => ({
      id,
      kind: "research",
      title: `Source ${id}`,
      state,
      extracted: 0,
      readable: true,
      ...more,
    });
    await show(
      review({
        sources: [
          source("a", "current", { extracted: 7 }),
          source("b", "changed"),
          source("c", "unread"),
          source("d", "withheld"),
          source("e", "partial", { extracted: 1 }),
          source("f", "structured", { readable: false }),
        ],
      }),
    );
    open("Sources");
    const rows = screen.getAllByTestId("pk-source");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Source aRead7 factsRead again",
      "Source bChanged since it was readRead again",
      "Source cNot read yetRead again",
      "Source dKept on this deviceRead again",
      "Source ePartly read1 factRead again",
      // No model reads the person's own structured material.
      "Source fYour own material",
    ]);
  });

  it("groups what the model read by its source, each fact with the words it rests on", async () => {
    await show(
      review({
        sources: [
          ...review().sources,
          {
            id: RESEARCH,
            kind: "research",
            title: "Glassdoor notes",
            state: "current",
            extracted: 1,
            readable: true,
          },
        ],
        records: [
          record(),
          record({
            id: "rec-2",
            text: "On-call one week in six",
            quote: "on-call rotation of six",
            section: undefined,
            level: undefined,
            reviewed: "confirmed",
          }),
          record({
            id: "rec-3",
            kind: "employer-fact",
            sourceId: RESEARCH,
            text: "The team is twelve engineers",
            quote: undefined,
            section: undefined,
            level: undefined,
            reviewed: "edited",
          }),
        ],
      }),
    );
    open("What the model read (3)");
    const groups = screen.getAllByTestId("pk-record-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent("The posting");
    expect(groups[1]).toHaveTextContent("Glassdoor notes");
    const first = within(groups[0] as HTMLElement).getAllByTestId("pk-record");
    expect(first).toHaveLength(2);
    expect(first[0]).toHaveTextContent(
      "Five years of TypeScript in production",
    );
    expect(first[0]).toHaveTextContent("Rests on: 5+ years of TypeScript");
    expect(first[0]).toHaveTextContent("must-have");
    expect(first[0]).toHaveTextContent("senior");
    expect(first[0]).not.toHaveTextContent("Confirmed");
    expect(
      within(first[0] as HTMLElement).getByTestId("pk-confirm"),
    ).toBeEnabled();
    // A confirmed fact says so, and is not offered for confirming again.
    expect(first[1]).toHaveTextContent("Confirmed");
    expect(
      within(first[1] as HTMLElement).queryByTestId("pk-confirm"),
    ).not.toBeInTheDocument();
    const second = within(groups[1] as HTMLElement).getByTestId("pk-record");
    expect(second).toHaveTextContent("The team is twelve engineers");
    expect(second).toHaveTextContent("Edited");
    expect(second).not.toHaveTextContent("Rests on:");
    expect(within(second).getByTestId("pk-confirm")).toBeInTheDocument();
  });
});

describe("preparing the pack", () => {
  it("shows how far it is, then the run's figures and the pack it answered with", async () => {
    await show(NOT_PREPARED);
    const held = preparing();
    click("pk-prepare");
    await settle();
    expect(client.prepare).toHaveBeenCalledTimes(1);
    expect(client.prepare).toHaveBeenCalledWith(
      ID,
      {},
      { signal: expect.any(AbortSignal), onProgress: expect.any(Function) },
    );
    expect(screen.getByTestId("pk-review")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    // Before the first line: nothing read, nothing asked.
    const bar = screen.getByTestId("pk-progress");
    // The library's line Progress has no progressbar role; it says its
    // percentage in words, which is what is read here.
    expect(bar).toHaveTextContent("0%");
    expect(bar).toHaveTextContent("0 model calls so far");
    expect(bar).not.toHaveTextContent("Reading:");
    expect(screen.queryByTestId("pk-prepare")).not.toBeInTheDocument();
    expect(screen.getByTestId("pk-cancel")).toBeEnabled();

    act(() => held.onProgress?.(progress()));
    expect(bar).toHaveTextContent("Reading: The posting, Glassdoor notes");
    expect(bar).toHaveTextContent("3 model calls so far");
    expect(bar).toHaveTextContent("25%");
    act(() =>
      held.onProgress?.(
        progress({ done: 3, reading: ["Call with Dana"], calls: 1 }),
      ),
    );
    expect(bar).toHaveTextContent("Reading: Call with Dana");
    expect(bar).toHaveTextContent("1 model call so far");
    expect(bar).toHaveTextContent("75%");

    await act(async () =>
      held.resolve(
        review({
          counts: [
            {
              kind: "employer-requirement",
              total: 12,
              extracted: 12,
              confirmed: 0,
              edited: 0,
            },
          ],
          stats: {
            sources: 3,
            extracted: 3,
            reused: 0,
            pieces: 12,
            calls: 14,
            linkCalls: 2,
            kept: 55,
            rejected: 3,
            holes: 0,
            links: 20,
          },
        }),
      ),
    );
    expect(screen.queryByTestId("pk-progress")).not.toBeInTheDocument();
    expect(screen.getByTestId("pk-stats")).toHaveTextContent(
      "Read 3 sources in 12 pieces, 14 model calls; kept 55 records, refused 3.",
    );
    expect(screen.getByTestId("pk-state")).toHaveTextContent("Prepared.");
    expect(screen.getByTestId("pk-count")).toHaveTextContent(
      "Requirements1212 read by a model",
    );
    expect(screen.getByTestId("pk-prepare")).toHaveTextContent("Prepare again");
    expect(screen.getByTestId("pk-prepare")).toBeEnabled();
    expect(screen.getByTestId("pk-review")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    // The answer is the review: it is not read a second time.
    expect(client.read).toHaveBeenCalledTimes(1);
  });

  it("Cancel stops it, says what was read is kept, and reads the pack again", async () => {
    await show(NOT_PREPARED);
    const held = preparing();
    click("pk-prepare");
    await settle();
    expect(held.signal?.aborted).toBe(false);
    client.read.mockResolvedValueOnce(
      review({
        prepared: true,
        counts: [
          {
            kind: "employer-fact",
            total: 2,
            extracted: 2,
            confirmed: 0,
            edited: 0,
          },
        ],
      }),
    );
    click("pk-cancel");
    expect(held.signal?.aborted).toBe(true);
    // The client answers a stopped preparation as `cancelled`.
    await act(async () =>
      held.reject(new DocumentsApiError("cancelled", null)),
    );
    expect(screen.getByTestId("pk-notice")).toHaveTextContent(
      "Stopped. What was read so far is kept.",
    );
    expect(screen.queryByTestId("pk-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pk-progress")).not.toBeInTheDocument();
    expect(client.read).toHaveBeenCalledTimes(2);
    expect(client.read).toHaveBeenLastCalledWith(ID);
    expect(screen.getByTestId("pk-count")).toHaveTextContent("Employer facts");
    expect(screen.getByTestId("pk-prepare")).toBeEnabled();
  });

  it.each([
    [
      "generation-unavailable",
      "No model is available to prepare the pack right now.",
    ],
    ["already-running", "This pack is already being prepared."],
    [
      "generation-failed",
      "The model could not prepare the pack. Nothing was lost; try again.",
    ],
    ["server-error", "That did not go through. Nothing changed; try again."],
  ])(
    "says why a preparation refused with %s did not go through",
    async (code, sentence) => {
      await show();
      client.prepare.mockRejectedValueOnce(new DocumentsApiError(code, null));
      click("pk-prepare");
      await settle();
      expect(screen.getByTestId("pk-error")).toHaveTextContent(sentence);
      // The pack that was shown is still shown, and it can be tried again.
      expect(screen.getByTestId("pk-state")).toHaveTextContent("Prepared.");
      expect(screen.queryByTestId("pk-progress")).not.toBeInTheDocument();
      expect(screen.getByTestId("pk-prepare")).toBeEnabled();
      expect(client.read).toHaveBeenCalledTimes(1);
    },
  );

  it("a failure that is not a refusal says nothing changed, and the next try clears it", async () => {
    await show();
    client.prepare.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    click("pk-prepare");
    await settle();
    expect(screen.getByTestId("pk-error")).toHaveTextContent(
      "That did not go through. Nothing changed; try again.",
    );
    preparing();
    click("pk-prepare");
    await settle();
    expect(screen.queryByTestId("pk-error")).not.toBeInTheDocument();
  });

  it("reads one source again by its id", async () => {
    await show();
    open("Sources");
    const held = preparing();
    click("pk-source-again");
    await settle();
    expect(client.prepare).toHaveBeenCalledTimes(1);
    expect(client.prepare).toHaveBeenCalledWith(
      ID,
      { sourceId: POSTING },
      { signal: expect.any(AbortSignal), onProgress: expect.any(Function) },
    );
    expect(screen.getByTestId("pk-progress")).toBeInTheDocument();
    expect(screen.getByTestId("pk-source-again")).toBeDisabled();
    await act(async () =>
      held.resolve(
        review({
          sources: [
            {
              ...review().sources[0],
              extracted: 9,
            } as PackReview["sources"][0],
          ],
        }),
      ),
    );
    expect(screen.getByTestId("pk-source")).toHaveTextContent("9 facts");
  });

  it("leaving the form stops a preparation in flight", async () => {
    await show();
    const held = preparing();
    click("pk-prepare");
    await settle();
    cleanup();
    expect(held.signal?.aborted).toBe(true);
  });
});

describe("correcting what the model read", () => {
  const WITH_RECORD = review({ records: [record()] });
  const openRecords = async (loaded: PackReview = WITH_RECORD) => {
    await show(loaded);
    open(`What the model read (${loaded.records.length})`);
  };

  it("Confirm sends the one correction and shows the answered pack", async () => {
    await openRecords();
    client.correct.mockResolvedValueOnce(
      review({ records: [record({ reviewed: "confirmed" })] }),
    );
    click("pk-confirm");
    await settle();
    expect(client.correct).toHaveBeenCalledTimes(1);
    expect(client.correct).toHaveBeenCalledWith(ID, [
      { recordId: "rec-1", action: "confirm" },
    ]);
    expect(screen.getByTestId("pk-record")).toHaveTextContent("Confirmed");
    expect(screen.queryByTestId("pk-confirm")).not.toBeInTheDocument();
  });

  it("Edit opens the fact for rewriting, and Save sends the new words", async () => {
    await openRecords();
    expect(screen.queryByTestId("pk-edit-text")).not.toBeInTheDocument();
    click("pk-edit");
    const field = screen.getByTestId("pk-edit-text");
    expect(field).toHaveValue("Five years of TypeScript in production");
    expect(field).toHaveAttribute("maxlength", "600");
    // Nothing to save while it is empty.
    type(field, "   ");
    expect(screen.getByTestId("pk-edit-save")).toBeDisabled();
    type(field, "  Six years of TypeScript  ");
    client.correct.mockResolvedValueOnce(
      review({
        records: [
          record({ text: "Six years of TypeScript", reviewed: "edited" }),
        ],
      }),
    );
    click("pk-edit-save");
    await settle();
    expect(client.correct).toHaveBeenCalledTimes(1);
    expect(client.correct).toHaveBeenCalledWith(ID, [
      { recordId: "rec-1", action: "edit", text: "Six years of TypeScript" },
    ]);
    expect(screen.queryByTestId("pk-edit-text")).not.toBeInTheDocument();
    const row = screen.getByTestId("pk-record");
    expect(row).toHaveTextContent("Six years of TypeScript");
    expect(row).toHaveTextContent("Edited");
  });

  it("Cancel closes the editor and sends nothing", async () => {
    await openRecords();
    click("pk-edit");
    type(screen.getByTestId("pk-edit-text"), "Something else");
    click("pk-edit-cancel");
    expect(screen.queryByTestId("pk-edit-text")).not.toBeInTheDocument();
    expect(screen.getByTestId("pk-record")).toHaveTextContent(
      "Five years of TypeScript in production",
    );
    expect(client.correct).not.toHaveBeenCalled();
    // Opened again, it starts from the fact, not from what was abandoned.
    click("pk-edit");
    expect(screen.getByTestId("pk-edit-text")).toHaveValue(
      "Five years of TypeScript in production",
    );
  });

  it("Remove asks first, then takes the fact out", async () => {
    await openRecords();
    click("pk-remove");
    expect(client.correct).not.toHaveBeenCalled();
    expect(screen.getByText("Remove this fact?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "It is taken out of the pack and stays out when the pack is prepared again.",
      ),
    ).toBeInTheDocument();
    client.correct.mockResolvedValueOnce(review());
    confirm("Remove");
    await settle();
    expect(client.correct).toHaveBeenCalledTimes(1);
    expect(client.correct).toHaveBeenCalledWith(ID, [
      { recordId: "rec-1", action: "remove" },
    ]);
    expect(screen.queryByTestId("pk-record")).not.toBeInTheDocument();
    expect(screen.getByText("What the model read (0)")).toBeInTheDocument();
  });

  it("Keep leaves the fact where it is", async () => {
    await openRecords();
    click("pk-remove");
    confirm("Keep");
    await settle();
    expect(client.correct).not.toHaveBeenCalled();
    expect(screen.getByTestId("pk-record")).toBeInTheDocument();
  });

  it("a refused correction says so and changes nothing", async () => {
    await openRecords();
    client.correct.mockRejectedValueOnce(
      new DocumentsApiError("invalid-request", null),
    );
    click("pk-confirm");
    await settle();
    expect(screen.getByTestId("pk-error")).toHaveTextContent(
      "That did not go through. Nothing changed; try again.",
    );
    expect(screen.getByTestId("pk-record")).not.toHaveTextContent("Confirmed");
    expect(screen.getByTestId("pk-confirm")).toBeEnabled();
  });
});

describe("while something is in flight", () => {
  const controls = [
    "pk-prepare",
    "pk-source-again",
    "pk-confirm",
    "pk-edit",
    "pk-remove",
  ];
  const openAll = () => {
    open("Sources");
    open("What the model read (1)");
  };

  it("every control is held while a correction runs", async () => {
    await show(review({ records: [record()] }));
    openAll();
    for (const each of controls) expect(screen.getByTestId(each)).toBeEnabled();
    client.correct.mockReturnValueOnce(new Promise(() => undefined));
    click("pk-confirm");
    await settle();
    expect(screen.getByTestId("pk-review")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    for (const each of controls)
      expect(screen.getByTestId(each)).toBeDisabled();
  });

  it("every control but Cancel is held while the pack is prepared", async () => {
    await show(review({ records: [record()] }));
    openAll();
    click("pk-edit");
    preparing();
    click("pk-prepare");
    await settle();
    for (const each of [
      "pk-source-again",
      "pk-confirm",
      "pk-edit",
      "pk-remove",
      "pk-edit-text",
      "pk-edit-save",
      "pk-edit-cancel",
    ])
      expect(screen.getByTestId(each)).toBeDisabled();
    expect(screen.getByTestId("pk-cancel")).toBeEnabled();
  });

  it("every control is held while the form around it is busy", async () => {
    await show(review({ records: [record()] }), true);
    openAll();
    for (const each of controls)
      expect(screen.getByTestId(each)).toBeDisabled();
    // The card itself is not the one at work.
    expect(screen.getByTestId("pk-review")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });
});
