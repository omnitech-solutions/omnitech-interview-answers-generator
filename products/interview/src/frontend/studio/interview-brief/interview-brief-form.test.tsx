// The Interview form's stages, "Employer said" and "Research" over a stubbed
// client: what is read is shown, every action sends exactly one call, the
// form shows what the server answers with, and a removal asks first. Every
// name here is invented.
import type {
  InterviewBrief,
  InterviewStage,
  StageTranscript,
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
import { InterviewBriefForm } from "./interview-brief-form";

const client = vi.hoisted(() => ({
  read: vi.fn(),
  addStage: vi.fn(),
  updateStage: vi.fn(),
  removeStage: vi.fn(),
  orderStages: vi.fn(),
  moveNotes: vi.fn(),
  pasteTranscript: vi.fn(),
  uploadTranscript: vi.fn(),
  recordings: vi.fn(),
  attachRecording: vi.fn(),
  readTranscript: vi.fn(),
  setTranscriptPolicy: vi.fn(),
  removeTranscript: vi.fn(),
  addEmployerSaid: vi.fn(),
  removeEmployerSaid: vi.fn(),
  addResearch: vi.fn(),
  uploadResearch: vi.fn(),
  readResearch: vi.fn(),
  keepCarriedResearch: vi.fn(),
  removeResearch: vi.fn(),
}));
vi.mock("./interview-brief-client", () => ({ interviewBriefClient: client }));
// The context pack's card has its own suite (pack-review.test.tsx). Here it
// is a stub that records what the form hands it.
const packSection = vi.hoisted(() => vi.fn((_props: unknown) => null));
vi.mock("./pack-review", () => ({ PackReviewSection: packSection }));

const ID = "22222222-2222-4222-8222-222222222222";
const FIRST = "33333333-3333-4333-8333-333333333331";
const SECOND = "33333333-3333-4333-8333-333333333332";
const SHA = "a".repeat(64);
const AT = "2026-11-03T17:30:00.000Z";

const transcript = (over: Partial<StageTranscript> = {}): StageTranscript => ({
  id: "44444444-4444-4444-8444-444444444441",
  stageId: FIRST,
  title: "Call with Dana",
  origin: "pasted",
  originName: null,
  capturePolicy: "permitted-remote",
  sendable: true,
  occurredAt: null,
  chars: 120,
  turns: 3,
  sha256: SHA,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const stage = (over: Partial<InterviewStage> = {}): InterviewStage => ({
  id: FIRST,
  ordinal: 1,
  kind: "hiring_manager",
  label: "Hiring manager",
  scheduledAt: null,
  durationMinutes: null,
  format: null,
  status: "scheduled",
  notes: null,
  offeredNotes: null,
  outcome: null,
  nextSteps: null,
  people: [],
  transcripts: [],
  ...over,
});
const brief = (over: Partial<InterviewBrief> = {}): InterviewBrief => ({
  candidacyId: ID,
  companyName: "Larkspur Analytics",
  title: "Principal Engineer",
  applicationNotes: null,
  stages: [stage()],
  employerSaid: [],
  research: [],
  ...over,
});
const TWO = [
  stage(),
  stage({ id: SECOND, ordinal: 2, kind: "technical", label: "Technical" }),
];

const settle = () => act(async () => undefined);
const type = (element: HTMLElement, value: string) =>
  fireEvent.change(element, { target: { value } });
const typeIn = (testId: string, value: string, within_?: HTMLElement) =>
  type(
    (within_ ? within(within_) : screen).getAllByTestId(
      testId,
    )[0] as HTMLElement,
    value,
  );
// The library Select: its trigger carries the test id and shows the chosen
// label; its options are `<testid>-option-<value>` once it is open.
const choose = (testId: string, value: string, within_?: HTMLElement) => {
  fireEvent.click(
    (within_ ? within(within_) : screen).getAllByTestId(
      testId,
    )[0] as HTMLElement,
  );
  fireEvent.click(screen.getByTestId(`${testId}-option-${value}`));
};
const click = (testId: string, at = 0) =>
  fireEvent.click(screen.getAllByTestId(testId)[at] as HTMLElement);
// A removal asks first: the confirmation is the library's, built into the page.
const confirm = (name: string) =>
  fireEvent.click(
    screen
      .getAllByRole("button", { name })
      .find((button) => !button.hasAttribute("data-testid")) as HTMLElement,
  );

async function show(loaded: InterviewBrief = brief()) {
  client.read.mockResolvedValueOnce(loaded);
  render(<InterviewBriefForm candidacyId={ID} />);
  await settle();
}
// Every stage's section is on the page; the second is opened to act in it.
const open = (label: string) => fireEvent.click(screen.getByText(label));

beforeEach(() => {
  for (const each of Object.values(client)) each.mockReset();
  packSection.mockClear();
});
afterEach(() => {
  cleanup();
});

describe("reading the interview", () => {
  it("mounts the context pack's card for its application, held while the form is busy", async () => {
    await show();
    expect(packSection).toHaveBeenLastCalledWith(
      { candidacyId: ID, disabled: false },
      undefined,
    );
    // A write in flight holds the card's controls with the form's own.
    client.addStage.mockReturnValueOnce(new Promise(() => undefined));
    typeIn("ib-stage-new-label", "Final");
    click("ib-stage-add");
    await settle();
    expect(packSection).toHaveBeenLastCalledWith(
      { candidacyId: ID, disabled: true },
      undefined,
    );
  });

  it("reads the application's brief once and shows each stage as its own section", async () => {
    await show(
      brief({
        stages: [
          stage({
            scheduledAt: AT,
            durationMinutes: 60,
            format: "video",
            notes: "NestJS: the reporting service.",
            outcome: "Went well.",
            people: [
              {
                id: "55555555-5555-4555-8555-555555555551",
                name: "Dana Whitlow",
                title: "Head of Platform",
                role: "hiring_manager",
              },
            ],
            transcripts: [transcript()],
          }),
          TWO[1] as InterviewStage,
        ],
      }),
    );
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read).toHaveBeenCalledWith(ID);
    expect(screen.getByText("1. Hiring manager")).toBeInTheDocument();
    expect(screen.getByText("2. Technical")).toBeInTheDocument();
    // The first stage is open, with what was stored.
    const first = screen.getAllByTestId("ib-stage")[0] as HTMLElement;
    expect(within(first).getByTestId("ib-stage-label")).toHaveValue(
      "Hiring manager",
    );
    expect(within(first).getByTestId("ib-stage-minutes")).toHaveValue(60);
    expect(within(first).getByTestId("ib-stage-format")).toHaveTextContent(
      "Video",
    );
    expect(within(first).getByTestId("ib-stage-notes")).toHaveValue(
      "NestJS: the reporting service.",
    );
    expect(within(first).getByTestId("ib-stage-outcome")).toHaveValue(
      "Went well.",
    );
    expect(within(first).getByTestId("ib-person-name")).toHaveValue(
      "Dana Whitlow",
    );
    expect(within(first).getByTestId("ib-person-role")).toHaveTextContent(
      "Hiring manager",
    );
    const row = within(first).getByTestId("ib-transcript-row");
    expect(row).toHaveTextContent("Call with Dana");
    expect(row).toHaveTextContent("Pasted");
    expect(row).toHaveTextContent("3 turns");
    expect(row).toHaveTextContent("May be read by a remote model");
  });

  it("says so when the brief cannot be read, and shows no form", async () => {
    client.read.mockRejectedValueOnce(new Error("offline"));
    render(<InterviewBriefForm candidacyId={ID} />);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not be read\. Try again/,
    );
    expect(screen.queryByTestId("ib-stages")).toBeNull();
  });

  it("shows an application with no stage, nothing said and no research as empty, with the ways to add", async () => {
    await show(brief({ stages: [] }));
    expect(screen.getByText("No stages yet")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing the employer said yet"),
    ).toBeInTheDocument();
    expect(screen.getByText("No research yet")).toBeInTheDocument();
    expect(screen.getByTestId("ib-stage-add")).toBeDisabled();
    expect(screen.getByTestId("ib-said-add")).toBeDisabled();
    expect(screen.getByTestId("ib-research-add")).toBeDisabled();
  });
});

describe("stages", () => {
  it("adds a stage by its name and kind, and shows what the server answers with", async () => {
    await show();
    client.addStage.mockResolvedValueOnce(brief({ stages: TWO }));
    typeIn("ib-stage-new-label", " Technical ");
    choose("ib-stage-new-kind", "panel");
    click("ib-stage-add");
    await settle();
    expect(client.addStage).toHaveBeenCalledTimes(1);
    expect(client.addStage).toHaveBeenCalledWith(ID, {
      kind: "panel",
      label: "Technical",
    });
    expect(screen.getByText("2. Technical")).toBeInTheDocument();
    // The field is ready for the next one.
    expect(screen.getByTestId("ib-stage-new-label")).toHaveValue("");
  });

  it("adds a person, and saves the stage whole: people, when, minutes, format, notes and outcome", async () => {
    await show();
    click("ib-person-add");
    click("ib-person-add");
    const people = screen.getAllByTestId("ib-person");
    expect(people).toHaveLength(2);
    typeIn("ib-person-name", "Dana Whitlow", people[0]);
    typeIn("ib-person-title", "Head of Platform", people[0]);
    choose("ib-person-role", "hiring_manager", people[0]);
    // A second row left without a name is not a person.
    typeIn("ib-person-title", "Recruiter", people[1]);
    typeIn("ib-stage-minutes", "60");
    choose("ib-stage-format", "video");
    choose("ib-stage-status", "completed");
    typeIn("ib-stage-when", "2026-11-03T10:30");
    typeIn("ib-stage-notes", "NestJS: the reporting service.");
    typeIn("ib-stage-outcome", "Went well.");
    typeIn("ib-stage-next", "A technical round.");
    client.updateStage.mockResolvedValueOnce(
      brief({ stages: [stage({ durationMinutes: 60, label: "Saved" })] }),
    );
    click("ib-stage-save");
    await settle();
    expect(client.updateStage).toHaveBeenCalledTimes(1);
    expect(client.updateStage).toHaveBeenCalledWith(ID, FIRST, {
      label: "Hiring manager",
      kind: "hiring_manager",
      status: "completed",
      format: "video",
      scheduledAt: new Date("2026-11-03T10:30").toISOString(),
      durationMinutes: 60,
      notes: "NestJS: the reporting service.",
      outcome: "Went well.",
      nextSteps: "A technical round.",
      people: [
        {
          name: "Dana Whitlow",
          title: "Head of Platform",
          role: "hiring_manager",
        },
      ],
    });
    // The section now shows the server's stage, not what was typed.
    expect(screen.getByTestId("ib-stage-label")).toHaveValue("Saved");
    expect(screen.queryAllByTestId("ib-person")).toHaveLength(0);
  });

  it("removes a person from the list before saving, and will not save minutes out of range", async () => {
    await show(
      brief({
        stages: [
          stage({
            people: [
              {
                id: "55555555-5555-4555-8555-555555555551",
                name: "Dana Whitlow",
                title: null,
                role: "interviewer",
              },
            ],
          }),
        ],
      }),
    );
    click("ib-person-remove");
    expect(screen.queryAllByTestId("ib-person")).toHaveLength(0);
    typeIn("ib-stage-minutes", "4");
    expect(screen.getByTestId("ib-stage-save")).toBeDisabled();
    expect(screen.getByText("Between 5 and 480.")).toBeInTheDocument();
    typeIn("ib-stage-minutes", "");
    typeIn("ib-stage-label", "  ");
    expect(screen.getByTestId("ib-stage-save")).toBeDisabled();
    typeIn("ib-stage-label", "Call");
    client.updateStage.mockResolvedValueOnce(brief());
    click("ib-stage-save");
    await settle();
    expect(client.updateStage.mock.calls[0]?.[2]).toMatchObject({
      label: "Call",
      people: [],
      durationMinutes: null,
      scheduledAt: null,
      format: null,
    });
  });

  it("reorders by sending every stage in the order wanted, and the ends cannot move past the ends", async () => {
    await show(brief({ stages: TWO }));
    open("2. Technical");
    const [up, ,] = screen.getAllByTestId("ib-stage-up");
    const downs = screen.getAllByTestId("ib-stage-down");
    expect(up).toBeDisabled();
    expect(downs.at(-1)).toBeDisabled();
    client.orderStages.mockResolvedValueOnce(
      brief({
        stages: [
          { ...(TWO[1] as InterviewStage), ordinal: 1 },
          { ...(TWO[0] as InterviewStage), ordinal: 2 },
        ],
      }),
    );
    click("ib-stage-down", 0);
    await settle();
    expect(client.orderStages).toHaveBeenCalledWith(ID, [SECOND, FIRST]);
    expect(screen.getByText("1. Technical")).toBeInTheDocument();
    expect(screen.getByText("2. Hiring manager")).toBeInTheDocument();
  });

  it("removes a stage only after the confirmation built into the page", async () => {
    await show(brief({ stages: TWO }));
    click("ib-stage-remove", 0);
    // Asked, and nothing sent yet.
    expect(
      screen.getByText('Remove the "Hiring manager" stage?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/transcripts and outcome are deleted/),
    ).toBeInTheDocument();
    expect(client.removeStage).not.toHaveBeenCalled();
    confirm("Keep");
    await settle();
    expect(client.removeStage).not.toHaveBeenCalled();
    expect(screen.getByText("1. Hiring manager")).toBeInTheDocument();

    client.removeStage.mockResolvedValueOnce(
      brief({ stages: [{ ...(TWO[1] as InterviewStage), ordinal: 1 }] }),
    );
    click("ib-stage-remove", 0);
    confirm("Remove stage");
    await settle();
    expect(client.removeStage).toHaveBeenCalledTimes(1);
    expect(client.removeStage).toHaveBeenCalledWith(ID, FIRST);
    expect(screen.queryByText("1. Hiring manager")).toBeNull();
    expect(screen.getByText("1. Technical")).toBeInTheDocument();
  });

  it("says why a stage in use is kept, in the person's words, and changes nothing", async () => {
    await show();
    client.removeStage.mockRejectedValueOnce(
      new DocumentsApiError("stage-in-use", null),
    );
    click("ib-stage-remove");
    confirm("Remove stage");
    await settle();
    expect(screen.getByTestId("ib-error")).toHaveTextContent(
      "A live session or a document was made for this stage, so it is kept.",
    );
    expect(screen.getByText("1. Hiring manager")).toBeInTheDocument();
    // A failure with no known code says so plainly.
    client.removeStage.mockRejectedValueOnce(new Error("offline"));
    click("ib-stage-remove");
    confirm("Remove stage");
    await settle();
    expect(screen.getByTestId("ib-error")).toHaveTextContent(
      "That did not go through. Nothing changed; try again.",
    );
  });

  it("offers the application's old notes to the first stage and moves them when asked", async () => {
    await show(
      brief({
        applicationNotes: "Round: the head of platform.",
        stages: [stage({ offeredNotes: "Round: the head of platform." })],
      }),
    );
    expect(screen.getByTestId("ib-offered-notes")).toHaveTextContent(
      /offered here until you move them\. 28 characters/,
    );
    // Offered, not yet the stage's own.
    expect(screen.getByTestId("ib-stage-notes")).toHaveValue("");
    client.moveNotes.mockResolvedValueOnce(
      brief({ stages: [stage({ notes: "Round: the head of platform." })] }),
    );
    click("ib-notes-move");
    await settle();
    expect(client.moveNotes).toHaveBeenCalledWith(ID);
    expect(screen.queryByTestId("ib-offered-notes")).toBeNull();
    expect(screen.getByTestId("ib-stage-notes")).toHaveValue(
      "Round: the head of platform.",
    );
  });
});

describe("a stage's transcripts", () => {
  const withTranscript = (over: Partial<StageTranscript> = {}) =>
    brief({ stages: [stage({ transcripts: [transcript(over)] })] });

  it("pastes a transcript, device-only unless the person says otherwise, then reads the brief again", async () => {
    await show();
    expect(screen.getByTestId("ib-transcript-paste")).toBeDisabled();
    expect(screen.getByTestId("ib-transcript-new-policy")).toHaveTextContent(
      "Stays on this device",
    );
    typeIn("ib-transcript-text", "Dana: hello\nMe: hi");
    client.pasteTranscript.mockResolvedValueOnce({
      transcript: transcript({ capturePolicy: "device-only" }),
    });
    client.read.mockResolvedValueOnce(
      withTranscript({ capturePolicy: "device-only", sendable: false }),
    );
    click("ib-transcript-paste");
    await settle();
    expect(client.pasteTranscript).toHaveBeenCalledWith(ID, FIRST, {
      text: "Dana: hello\nMe: hi",
      capturePolicy: "device-only",
    });
    expect(client.read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("ib-transcript-policy")).toHaveTextContent(
      "Stays on this device",
    );
    expect(screen.getByTestId("ib-transcript-text")).toHaveValue("");
  });

  it("sends the policy chosen with a pasted transcript", async () => {
    await show();
    choose("ib-transcript-new-policy", "permitted-remote");
    typeIn("ib-transcript-text", "Dana: hello");
    client.pasteTranscript.mockResolvedValueOnce({ transcript: transcript() });
    client.read.mockResolvedValueOnce(withTranscript());
    click("ib-transcript-paste");
    await settle();
    expect(client.pasteTranscript.mock.calls[0]?.[2]).toEqual({
      text: "Dana: hello",
      capturePolicy: "permitted-remote",
    });
  });

  it("uploads a file with the policy chosen", async () => {
    await show();
    const file = new File(["WEBVTT\n"], "round.vtt", { type: "text/vtt" });
    const input = screen
      .getByTestId("ib-stages")
      .querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    client.uploadTranscript.mockResolvedValueOnce({ transcript: transcript() });
    client.read.mockResolvedValueOnce(
      withTranscript({ origin: "uploaded", title: "round" }),
    );
    fireEvent.change(input, { target: { files: [file] } });
    await settle();
    expect(client.uploadTranscript).toHaveBeenCalledTimes(1);
    expect(client.uploadTranscript).toHaveBeenCalledWith(
      ID,
      FIRST,
      file,
      "device-only",
    );
    expect(screen.getByTestId("ib-transcript-row")).toHaveTextContent(
      "Uploaded",
    );
  });

  it("says a malformed or oversized transcript was refused, and keeps what was typed", async () => {
    await show();
    typeIn("ib-transcript-text", "   x");
    client.pasteTranscript.mockRejectedValueOnce(
      new DocumentsApiError("invalid-transcript", null),
    );
    click("ib-transcript-paste");
    await settle();
    expect(screen.getByTestId("ib-error")).toHaveTextContent(
      /not a transcript this form can read/,
    );
    expect(screen.getByTestId("ib-transcript-text")).toHaveValue("   x");
    client.pasteTranscript.mockRejectedValueOnce(
      new DocumentsApiError("body-too-large", null),
    );
    click("ib-transcript-paste");
    await settle();
    expect(screen.getByTestId("ib-error")).toHaveTextContent(
      "That is larger than this form takes.",
    );
  });

  it("attaches the recording the Studio just made: lists the person's own, each with its policy", async () => {
    await show();
    expect(screen.queryByTestId("ib-recordings")).toBeNull();
    client.recordings.mockResolvedValueOnce({
      recordings: [
        {
          file: "2026-11-03T17-39-54-120-abcdef12.txt",
          startedAt: "2026-11-03T17:39:54.120Z",
          bytes: 300,
          capturePolicy: "device-only",
          attached: false,
        },
        {
          file: "2026-11-01T09-00-00-000-abcdef34.txt",
          startedAt: "2026-11-01T09:00:00.000Z",
          bytes: 200,
          capturePolicy: "permitted-remote",
          attached: true,
        },
      ],
    });
    click("ib-recordings-open");
    await settle();
    expect(client.recordings).toHaveBeenCalledWith(ID);
    const rows = screen.getAllByTestId("ib-recording-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Stays on this device");
    expect(rows[1]).toHaveTextContent("Attached");
    const attach = screen.getAllByTestId("ib-recording-attach");
    // One already attached to this application is not attached twice.
    expect(attach[1]).toBeDisabled();
    client.attachRecording.mockResolvedValueOnce({
      transcript: transcript({ origin: "recorded" }),
    });
    client.read.mockResolvedValueOnce(
      withTranscript({
        origin: "recorded",
        capturePolicy: "device-only",
        sendable: false,
        title: "Recorded 2026-11-03",
      }),
    );
    fireEvent.click(attach[0] as HTMLElement);
    await settle();
    expect(client.attachRecording).toHaveBeenCalledWith(
      ID,
      FIRST,
      "2026-11-03T17-39-54-120-abcdef12.txt",
    );
    const row = screen.getByTestId("ib-transcript-row");
    expect(row).toHaveTextContent("Recorded by the Studio");
    expect(row).toHaveTextContent("Stays on this device");
    // The list closes, and a device-only recording offers no way to loosen it.
    expect(screen.queryByTestId("ib-recordings")).toBeNull();
    expect(screen.queryByTestId("ib-transcript-policy-select")).toBeNull();
  });

  it("says so when the Studio has no recording of the person's", async () => {
    await show();
    client.recordings.mockResolvedValueOnce({ recordings: [] });
    click("ib-recordings-open");
    await settle();
    expect(screen.getByTestId("ib-recordings")).toHaveTextContent(
      /has no recording of yours/,
    );
  });

  it("lets the person change where a pasted transcript may be read, and removes one after asking", async () => {
    await show(withTranscript());
    client.setTranscriptPolicy.mockResolvedValueOnce({
      transcript: transcript(),
    });
    client.read.mockResolvedValueOnce(
      withTranscript({ capturePolicy: "device-only", sendable: false }),
    );
    choose("ib-transcript-policy-select", "device-only");
    await settle();
    expect(client.setTranscriptPolicy).toHaveBeenCalledWith(
      ID,
      FIRST,
      transcript().id,
      "device-only",
    );
    expect(screen.getByTestId("ib-transcript-policy")).toHaveTextContent(
      "Stays on this device",
    );
    click("ib-transcript-remove");
    expect(screen.getByText('Remove "Call with Dana"?')).toBeInTheDocument();
    expect(client.removeTranscript).not.toHaveBeenCalled();
    client.removeTranscript.mockResolvedValueOnce(brief());
    confirm("Remove");
    await settle();
    expect(client.removeTranscript).toHaveBeenCalledWith(
      ID,
      FIRST,
      transcript().id,
    );
    expect(screen.queryByTestId("ib-transcript-row")).toBeNull();
  });
});

describe("employer said", () => {
  const entry = {
    id: "66666666-6666-4666-8666-666666666661",
    said: "No AI assistants in live rounds.",
    saidBy: "Sam Reyes",
    channel: "email" as const,
    saidOn: "2026-10-28",
    sha256: SHA,
    createdAt: AT,
    updatedAt: AT,
  };

  it("adds a dated entry with who said it and how", async () => {
    await show();
    typeIn("root_said", " No AI assistants in live rounds. ");
    typeIn("root_saidBy", "Sam Reyes");
    choose("root_channel", "email");
    typeIn("root_saidOn", "2026-10-28");
    client.addEmployerSaid.mockResolvedValueOnce(
      brief({ employerSaid: [entry] }),
    );
    click("ib-said-add");
    await settle();
    expect(client.addEmployerSaid).toHaveBeenCalledWith(ID, {
      said: "No AI assistants in live rounds.",
      saidBy: "Sam Reyes",
      channel: "email",
      saidOn: "2026-10-28",
    });
    expect(screen.getByTestId("ib-said-row")).toHaveTextContent(
      "2026-10-28, Sam Reyes (email): No AI assistants in live rounds.",
    );
    expect(screen.getByTestId("root_said")).toHaveValue("");
  });

  it("adds an entry with only what was said, and marks one with no date", async () => {
    await show(
      brief({
        employerSaid: [{ ...entry, saidBy: null, channel: null, saidOn: null }],
      }),
    );
    expect(screen.getByTestId("ib-said-row")).toHaveTextContent("No date");
    typeIn("root_said", "Two rounds.");
    client.addEmployerSaid.mockResolvedValueOnce(brief());
    click("ib-said-add");
    await settle();
    expect(client.addEmployerSaid).toHaveBeenCalledWith(ID, {
      said: "Two rounds.",
    });
  });

  it("removes an entry only after asking", async () => {
    await show(brief({ employerSaid: [entry] }));
    click("ib-said-remove");
    expect(screen.getByText("Remove this entry?")).toBeInTheDocument();
    expect(client.removeEmployerSaid).not.toHaveBeenCalled();
    client.removeEmployerSaid.mockResolvedValueOnce(brief());
    confirm("Remove");
    await settle();
    expect(client.removeEmployerSaid).toHaveBeenCalledWith(ID, entry.id);
    expect(screen.queryByTestId("ib-said-row")).toBeNull();
  });
});

describe("research", () => {
  const document = {
    id: "77777777-7777-4777-8777-777777777771",
    scope: "application" as const,
    title: "Company overview",
    origin: "pasted" as const,
    originRef: null,
    chars: 1200,
    sha256: SHA,
    carried: false,
    createdAt: AT,
    updatedAt: AT,
  };

  it("adds pasted research, and a link's text with where it came from", async () => {
    await show();
    typeIn("ib-research-title", "Company overview");
    typeIn("ib-research-text", "Larkspur sells tide forecasts.");
    client.addResearch.mockResolvedValueOnce(brief({ research: [document] }));
    click("ib-research-add");
    await settle();
    expect(client.addResearch).toHaveBeenCalledWith(ID, {
      title: "Company overview",
      text: "Larkspur sells tide forecasts.",
    });
    const row = screen.getByTestId("ib-research-row");
    expect(row).toHaveTextContent("Company overview");
    expect(row).toHaveTextContent("Pasted");
    expect(row).toHaveTextContent("1,200 characters");

    typeIn("ib-research-title", "Blog");
    typeIn("ib-research-link", "https://example.invalid/blog");
    typeIn("ib-research-text", "Rebuilt nightly.");
    client.addResearch.mockResolvedValueOnce(brief({ research: [document] }));
    click("ib-research-add");
    await settle();
    expect(client.addResearch).toHaveBeenLastCalledWith(ID, {
      title: "Blog",
      text: "Rebuilt nightly.",
      originRef: "https://example.invalid/blog",
    });
  });

  it("uploads a text file as research", async () => {
    await show();
    const file = new File(["Interviewer background."], "panel.md");
    const input = screen
      .getByTestId("ib-research")
      .querySelector('input[type="file"]') as HTMLInputElement;
    client.uploadResearch.mockResolvedValueOnce(
      brief({
        research: [
          {
            ...document,
            title: "panel",
            origin: "file",
            originRef: "panel.md",
          },
        ],
      }),
    );
    fireEvent.change(input, { target: { files: [file] } });
    await settle();
    expect(client.uploadResearch).toHaveBeenCalledWith(ID, file);
    expect(screen.getByTestId("ib-research-row")).toHaveTextContent("panel.md");
  });

  it("offers the company's old research text as one document to keep, never to remove", async () => {
    await show(
      brief({
        research: [
          {
            ...document,
            id: "carried-company-research",
            scope: "company",
            title: "Company research",
            carried: true,
            createdAt: null,
            updatedAt: null,
          },
        ],
      }),
    );
    expect(screen.getByTestId("ib-research-row")).toHaveTextContent(
      "Carried over",
    );
    expect(screen.queryByTestId("ib-research-remove")).toBeNull();
    client.keepCarriedResearch.mockResolvedValueOnce(
      brief({ research: [{ ...document, title: "Company research" }] }),
    );
    click("ib-research-keep");
    await settle();
    expect(client.keepCarriedResearch).toHaveBeenCalledWith(ID);
    expect(screen.getByTestId("ib-research-row")).not.toHaveTextContent(
      "Carried over",
    );
    expect(screen.getByTestId("ib-research-remove")).toBeInTheDocument();
  });

  it("removes a document only after asking", async () => {
    await show(brief({ research: [document] }));
    click("ib-research-remove");
    expect(screen.getByText('Remove "Company overview"?')).toBeInTheDocument();
    expect(client.removeResearch).not.toHaveBeenCalled();
    confirm("Keep");
    await settle();
    expect(client.removeResearch).not.toHaveBeenCalled();
    client.removeResearch.mockResolvedValueOnce(brief());
    click("ib-research-remove");
    confirm("Remove");
    await settle();
    expect(client.removeResearch).toHaveBeenCalledWith(ID, document.id);
    expect(screen.queryByTestId("ib-research-row")).toBeNull();
  });
});

describe("while a write is in flight", () => {
  it("takes no second one, and says the form is busy", async () => {
    await show();
    let release: (value: InterviewBrief) => void = () => undefined;
    client.addEmployerSaid.mockReturnValueOnce(
      new Promise<InterviewBrief>((resolve) => {
        release = resolve;
      }),
    );
    typeIn("root_said", "Two rounds.");
    click("ib-said-add");
    await settle();
    expect(screen.getByTestId("ib-form")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("ib-stage-save")).toBeDisabled();
    expect(screen.getByTestId("ib-stage-remove")).toBeDisabled();
    expect(screen.getByTestId("ib-research-title")).toBeDisabled();
    await act(async () => release(brief()));
    expect(screen.getByTestId("ib-form")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByTestId("ib-stage-save")).toBeEnabled();
  });
});
