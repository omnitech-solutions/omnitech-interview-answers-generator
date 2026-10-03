// The live session body: the Transcript, Activity and Sources tabs.
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftLink } from "./live-draft-link";
import { answerAction, show, spies } from "./live-view-kit";
import {
  action,
  disconnected,
  gap,
  minutesAfter,
  snapshot,
  stored,
  transcript,
} from "./session-fixtures";
import { answerResult, codeResult } from "./session-result-fixtures";

vi.mock("./workspace-handoff", async () => {
  const kit = await import("./live-draft-link");
  return { useSessionDraftLink: () => kit.draftLink.current };
});

beforeEach(() => {
  draftLink.current = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("tabs", () => {
  it("moves with the arrow keys, Home and End, and follows focus", () => {
    show({});
    const [transcriptTab, activityTab, sourcesTab] = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist")).toBeVisible();
    expect(transcriptTab).toHaveAttribute("aria-selected", "true");
    expect(activityTab).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(transcriptTab as HTMLElement, { key: "ArrowRight" });
    expect(activityTab).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(activityTab);
    fireEvent.keyDown(activityTab as HTMLElement, { key: "End" });
    expect(sourcesTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(sourcesTab as HTMLElement, { key: "ArrowRight" });
    expect(transcriptTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(transcriptTab as HTMLElement, { key: "ArrowLeft" });
    expect(sourcesTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(sourcesTab as HTMLElement, { key: "Home" });
    expect(transcriptTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      (transcriptTab as HTMLElement).id,
    );
  });
});

describe("transcript", () => {
  it("shows the empty copy", () => {
    show({});
    expect(
      screen.getByText(
        "Transcript lines appear here once the companion finalises them.",
      ),
    ).toBeVisible();
  });

  it("shows lines by source, a corrected line dimmed, gaps, disconnects, snapshots and new tasks", () => {
    show({
      session: {
        captureSources: ["microphone", "application-audio", "screen"],
      },
      observations: [
        transcript(1, "Tell me about a migration."),
        transcript(2, "Tell me about a migraine.", { sourceId: "microphone" }),
        {
          ...transcript(3, "Tell me about a migration, please."),
          content: stored(3, {
            speaker: "speaker-1",
            text: "Tell me about a migration, please.",
            startMs: 3000,
            endMs: 3800,
            supersedes: "evt-2",
          }),
        },
        gap(4, "application-audio", "buffer-overflow", 3000),
        disconnected(5, "microphone", "user-stopped"),
        snapshot(6, "Editor window"),
      ],
      actions: [
        answerAction(answerResult(), {
          createdAt: minutesAfter(0, 1),
          updatedAt: minutesAfter(0, 2),
        }),
      ],
    });
    const rows = screen.getAllByTestId("transcript-row");
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const corrected = screen
      .getByText("Tell me about a migraine.")
      .closest("li");
    expect(corrected).toHaveAttribute("data-superseded", "true");
    expect(
      within(corrected as HTMLElement).getByText("corrected"),
    ).toBeVisible();
    expect(
      within(corrected as HTMLElement).getByText("Microphone"),
    ).toBeVisible();
    expect(
      screen.getByText(
        /App audio: 3 s not captured because the capture buffer filled/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Microphone disconnected: stopped on the Mac/),
    ).toBeVisible();
    expect(screen.getByText("Screen · Editor window · snapshot")).toBeVisible();
    expect(screen.getByText(/New task: experience question/)).toBeVisible();
  });

  it("offers a screenshot only as a download through the owner's route, never inline", () => {
    show({ observations: [snapshot(1, "Editor window")] });
    const link = screen.getByRole("link", { name: "Download" });
    expect(link.getAttribute("href")).toMatch(
      /^\/api\/interview\/t\/local\/sessions\/[^/]+\/screenshots\/artifact-1$/,
    );
    expect(link).toHaveAttribute("download");
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders a transcript line that contains markup as text", () => {
    show({ observations: [transcript(1, "<script>alert(1)</script> hello")] });
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script> hello")).toBeVisible();
  });
});

describe("activity", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  it("says no work started yet and that outdated results are never published", () => {
    show({});
    open();
    expect(screen.getByText("No work started yet.")).toBeVisible();
    expect(
      screen.getByText(
        /Results for an outdated task revision are never published\./,
      ),
    ).toBeVisible();
  });

  it("shows the profile and policy each published run used (ADR-0012)", () => {
    show({
      actions: [
        answerAction(answerResult(), { taskId: "t1" }),
        action({
          taskId: "t2",
          actionKind: "solve-code",
          result: codeResult({
            meta: { profileId: "main", processingPolicy: "permitted-remote" },
          }),
        }),
        action({
          taskId: "t3",
          dispatchStatus: "suppressed",
          suppressionReason: "revision_stale",
        }),
      ],
    });
    open();
    const items = within(
      screen.getByRole("list", { name: "Runs" }),
    ).getAllByRole("listitem");
    const text = items.map((item) => item.textContent ?? "");
    expect(text.some((t) => /Profile fast · device-only policy/.test(t))).toBe(
      true,
    );
    expect(
      text.some((t) => /Profile main · remote processing allowed/.test(t)),
    ).toBe(true);
    // A run with no result names no profile: nothing is guessed.
    expect(text.filter((t) => /Profile /.test(t))).toHaveLength(2);
  });

  it("labels each run with what became of it", () => {
    show({
      actions: [
        answerAction(answerResult(), { taskId: "t1" }),
        action({
          taskId: "t2",
          dispatchStatus: "in_flight",
          createdAt: minutesAfter(1, 10),
          updatedAt: minutesAfter(1, 11),
        }),
        action({
          taskId: "t3",
          dispatchStatus: "suppressed",
          suppressionReason: "revision_stale",
          createdAt: minutesAfter(1, 12),
          updatedAt: minutesAfter(1, 13),
        }),
        action({
          taskId: "t4",
          dispatchStatus: "suppressed",
          suppressionReason: "session_paused",
          createdAt: minutesAfter(1, 14),
          updatedAt: minutesAfter(1, 15),
        }),
        action({
          taskId: "t5",
          dispatchStatus: "failed",
          createdAt: minutesAfter(1, 16),
          updatedAt: minutesAfter(1, 17),
        }),
        action({
          taskId: "t6",
          actionKind: "solve-code",
          dispatchStatus: "suppressed",
          suppressionReason: "policy_refused",
          createdAt: minutesAfter(1, 18),
          updatedAt: minutesAfter(1, 19),
        }),
        action({
          taskId: "t7",
          actionKind: "solve-code",
          result: codeResult({
            workspace: {
              published: false,
              conflict: true,
              reason: "edited",
              expectedRevision: 1,
              foundRevision: 2,
            },
          }),
          createdAt: minutesAfter(1, 20),
          updatedAt: minutesAfter(1, 21),
        }),
      ],
    });
    open();
    const list = screen.getByRole("list", { name: "Runs" });
    const labels = within(list)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("data-state"));
    expect(labels.sort()).toEqual(
      [
        "cancelled",
        "discarded",
        "failed",
        "held-conflict",
        "published",
        "refused",
        "running",
      ].sort(),
    );
    for (const label of [
      "Published",
      "Drafting",
      "Discarded",
      "Cancelled",
      "Failed",
      "Refused",
      "Held",
    ])
      expect(
        within(list).getByText(label, { selector: ".live-chip" }),
      ).toBeVisible();
  });
});

describe("sources", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("tab", { name: "Sources" }));

  it("lists each source with its health and the companion only as seen", () => {
    show({
      session: { lastHeartbeatAt: null },
      observations: [],
    });
    open();
    expect(screen.getByText("Microphone")).toBeVisible();
    expect(
      screen.getByText("Labelled “Microphone”, not a speaker name"),
    ).toBeVisible();
    expect(screen.getByText("Not selected")).toBeVisible();
    const companion = screen.getByTestId("companion-row");
    expect(companion).toHaveTextContent("Waiting for first contact");
    expect(companion).not.toHaveTextContent(/connected/i);
    expect(companion).toHaveTextContent("renewed here, by you");
    expect(companion).not.toHaveTextContent(/10 min/);
  });

  it("never lists a source as receiving while the companion is out of contact", () => {
    show({
      session: { lastHeartbeatAt: minutesAfter(0, 10) },
      observations: [
        transcript(1, "Earlier words.", { sourceId: "microphone" }),
      ],
      nowMinutes: 5,
    });
    open();
    const row = screen.getByText("Microphone").closest("li") as HTMLElement;
    expect(row).not.toHaveTextContent("Receiving");
    expect(row).toHaveTextContent("No recent contact");
    expect(screen.getByTestId("companion-row")).toHaveTextContent(
      "No contact for 4 min",
    );
  });

  it("shows contact and credential state once heard from", () => {
    show({
      session: {
        lastHeartbeatAt: minutesAfter(1, 55),
        credentialExpiresAt: minutesAfter(8),
      },
    });
    open();
    const companion = screen.getByTestId("companion-row");
    expect(companion).toHaveTextContent(
      "In contact · last heard less than a minute ago",
    );
    expect(companion).toHaveTextContent("Credential expires in 6 min.");
  });

  it("mounts the pairing panel in the tab", () => {
    show({});
    open();
    expect(screen.getByTestId("pairing-slot")).toBeInTheDocument();
  });

  it("shows only what is true in the capability table for a device-only session", () => {
    show({ session: { processingPolicy: "device-only" } });
    open();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Speech").closest("tr")).toHaveTextContent(
      "On this Mac, in the companion",
    );
    expect(
      within(table).getByText("Answer drafts").closest("tr"),
    ).toHaveTextContent("On this Mac");
    expect(
      within(table).getByText("Coding drafts and tests").closest("tr"),
    ).toHaveTextContent("Refused: needs a remote model");
    expect(
      within(table).getByText("Raw audio").closest("tr"),
    ).toHaveTextContent("Memory only, never saved");
    expect(
      screen.queryByRole("button", { name: "Switch to this Mac only" }),
    ).toBeNull();
  });

  it("switches to this Mac only after a confirmation, and can be cancelled", async () => {
    const { actions } = show({
      session: { processingPolicy: "permitted-remote" },
    });
    open();
    expect(screen.getByText("Remote allowed")).toBeVisible();
    expect(
      within(screen.getByRole("table"))
        .getByText("Answer drafts")
        .closest("tr"),
    ).toHaveTextContent("Remote model, through Studio's AI gateway");
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to this Mac only" }),
    );
    const group = screen.getByRole("group", {
      name: "Switch to this Mac only",
    });
    expect(group).toHaveTextContent("This can’t be undone for this session.");
    expect(actions.tightenLocality).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("group", { name: "Switch to this Mac only" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to this Mac only" }),
    );
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("group", { name: "Switch to this Mac only" }),
        ).getByRole("button", { name: "Switch to this Mac only" }),
      );
    });
    expect(actions.tightenLocality).toHaveBeenCalledTimes(1);
  });

  it("reports a refused change by its fixed code", async () => {
    const actions = spies();
    actions.tightenLocality.mockResolvedValue({
      ok: false,
      code: "status_refused",
    } as never);
    show({ session: { processingPolicy: "permitted-remote" } }, actions);
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to this Mac only" }),
    );
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("group")).getByRole("button", {
          name: "Switch to this Mac only",
        }),
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent("status_refused");
  });

  it("offers only shorter retention modes, each behind a confirmation", async () => {
    const { actions } = show({ session: { retention: "until-deleted" } });
    open();
    expect(screen.getByText("Kept until you delete it.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Shorten to Delete at end" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Shorten to Until I delete/ }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Shorten to 30 days" }));
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("group", { name: "Shorten to 30 days" }),
        ).getByRole("button", { name: "Shorten to 30 days" }),
      );
    });
    expect(actions.shortenRetention).toHaveBeenCalledWith("thirty-days");
  });

  it("offers no shortening when retention is already the shortest", () => {
    show({ session: { retention: "delete-at-end" } });
    open();
    expect(screen.queryByRole("button", { name: /Shorten to/ })).toBeNull();
  });
});
