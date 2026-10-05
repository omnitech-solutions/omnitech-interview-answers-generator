// The live session body: idle states, banners and answers (see live-view-kit.tsx).
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
import { disconnected, gap, minutesAfter } from "./session-fixtures";
import {
  answerResult,
  logisticsResult,
  starResult,
} from "./session-result-fixtures";

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

describe("idle states", () => {
  it("says it is ready, and how to ask, when nothing is happening", () => {
    show({});
    expect(screen.getByText("Ready")).toBeVisible();
    expect(
      screen.getByText(/press Capture & analyze, dictate, or type a follow-up/),
    ).toBeVisible();
  });
  it("says paused when paused", () => {
    show({ session: { status: "paused" } });
    const idle = screen.getByTestId("live-idle");
    expect(idle).toHaveAttribute("data-activity", "paused");
    expect(idle).not.toHaveTextContent(/Ready/);
  });
  it("is the same ready state whether or not a companion source is lost", () => {
    show({
      session: { captureSources: ["microphone", "application-audio"] },
      observations: [disconnected(1, "application-audio", "device-lost")],
    });
    const idle = screen.getByTestId("live-idle");
    expect(idle).toHaveAttribute("data-activity", "idle");
    expect(idle).not.toHaveTextContent(/lost/i);
  });
  it("never waits for the companion: no contact yet, or gone quiet, is just ready", () => {
    for (const build of [
      () => show({ session: { lastHeartbeatAt: null } }),
      () =>
        show({
          session: { lastHeartbeatAt: minutesAfter(0, 10) },
          nowMinutes: 9,
        }),
    ]) {
      cleanup();
      build();
      const idle = screen.getByTestId("live-idle");
      expect(idle).toHaveTextContent("Ready");
      expect(idle).not.toHaveTextContent(/companion|waiting|no contact/i);
    }
  });
});

describe("banners", () => {
  it("shows a paused banner with Resume", async () => {
    const { actions } = show({ session: { status: "paused" } });
    const banner = screen.getByText(/^Paused\./).closest("[role]");
    expect(banner).toHaveAttribute("role", "status");
    fireEvent.click(
      within(banner as HTMLElement).getByRole("button", { name: "Resume" }),
    );
    expect(actions.resume).toHaveBeenCalledTimes(1);
  });

  it("renews and then resumes when resume asks for a new credential", async () => {
    const actions = spies();
    actions.resume
      .mockResolvedValueOnce({
        ok: false,
        code: "credential_renewal_required",
      } as never)
      .mockResolvedValueOnce({ ok: true });
    show({ session: { status: "paused" } }, actions);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });
    expect(actions.renewCredential).toHaveBeenCalledTimes(1);
    expect(actions.resume).toHaveBeenCalledTimes(2);
    // The new credential is handed over in the Sources tab.
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("pairing-slot")).toBeInTheDocument();
  });

  it("is a red alert for a revoked permission and says what Studio observed", () => {
    show({
      session: { captureSources: ["microphone", "screen"] },
      observations: [disconnected(1, "screen", "permission-revoked")],
    });
    const banner = screen
      .getByText(/permission for Screen was revoked/)
      .closest("[role]");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("System Settings");
  });

  it("covers a lost microphone and a lost screen", () => {
    show({
      session: { captureSources: ["microphone", "screen"] },
      observations: [
        disconnected(1, "microphone", "device-lost"),
        disconnected(2, "screen", "error"),
      ],
    });
    expect(screen.getByText(/Microphone was lost/)).toBeVisible();
    expect(screen.getByText(/Your voice isn't being heard/)).toBeVisible();
    expect(
      screen.getByText(/Screen stopped after a capture error/),
    ).toBeVisible();
  });

  const gapOfAppAudio = {
    observations: [gap(1, "application-audio", "buffer-overflow", 4000)],
  };
  const gapBanner = () =>
    screen.getByText(/of capture was dropped/).closest("[role]") as HTMLElement;

  it("in the Mac app, sends a gap to Sources and does not pretend to reconnect", () => {
    show(gapOfAppAudio, spies(), "native");
    const banner = gapBanner();
    expect(banner).toHaveTextContent("recorded in the transcript");
    expect(
      within(banner).queryByRole("button", { name: /reconnect/i }),
    ).toBeNull();
    fireEvent.click(
      within(banner).getByRole("button", { name: "Open Sources" }),
    );
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByTestId("pairing-slot")).toBeNull();
  });

  it("in a browser, Pair companion opens Sources and reveals the credential panel", () => {
    show(gapOfAppAudio, spies(), "browser");
    fireEvent.click(
      within(gapBanner()).getByRole("button", { name: "Pair companion" }),
    );
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("pairing-slot")).toBeInTheDocument();
  });

  it("raises no banner about a companion that is quiet or never seen", () => {
    show({ session: { lastHeartbeatAt: minutesAfter(0, 10) }, nowMinutes: 9 });
    expect(screen.queryByText(/No contact from the companion/)).toBeNull();
    cleanup();
    show({ session: { lastHeartbeatAt: null } });
    expect(screen.queryByText(/contact from the companion/i)).toBeNull();
  });

  it("renews from an expired-credential banner", async () => {
    const { actions } = show({
      session: { status: "paused", credentialExpiresAt: minutesAfter(1) },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Renew credential" }));
    });
    expect(actions.renewCredential).toHaveBeenCalledTimes(1);
    // Paused: renewal is followed by a resume.
    expect(actions.resume).toHaveBeenCalledTimes(1);
  });

  it("warns that the duration limit is near", () => {
    show({ session: { expiresAt: minutesAfter(8) } });
    expect(
      screen.getByText(/left before the session reaches its duration limit/),
    ).toBeVisible();
  });
});

describe("experience answer", () => {
  const withEveryKind = () =>
    answerResult({
      claims: [
        {
          kind: "matrix-backed",
          text: "I led a migration at Example Corp.",
          refs: [
            {
              sourceId: "e1",
              revision: 3,
              pointer: "/roles/1/summary",
              quote: "Led a database migration.",
            },
          ],
        },
        {
          kind: "preference-backed",
          text: "I prefer a hybrid arrangement.",
          refs: [
            {
              sourceId: "c1",
              revision: 3,
              pointer: "/context/work/0",
              quote: "Hybrid preferred.",
            },
          ],
        },
        {
          kind: "suggested-interpretation",
          text: "Frame it as risk reduction.",
          refs: [],
        },
        {
          kind: "general-knowledge",
          text: "Blue-green keeps the old version warm.",
          refs: [],
        },
        {
          kind: "not-in-matrix",
          text: "I cut costs by thirty percent.",
          refs: [],
        },
      ],
    });

  it("labels each claim with where it comes from", () => {
    show({ actions: [answerAction(withEveryKind())] });
    expect(screen.getByText("Suggested answer")).toBeVisible();
    expect(
      screen.getByText(
        /This suggested draft does not set candidate preferences/,
      ),
    ).toBeVisible();
    const kinds = Array.from(
      document.querySelectorAll("[data-claim-kind]"),
    ).map((el) => el.getAttribute("data-claim-kind"));
    expect(kinds).toEqual([
      "matrix-backed",
      "preference-backed",
      "suggested-interpretation",
      "general-knowledge",
      "not-in-matrix",
    ]);
    expect(
      screen.getByRole("button", { name: /From your matrix · Role 2/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /From your preferences · Candidate context/,
      }),
    ).toBeVisible();
    expect(screen.getByText("Suggested framing · not a claim")).toBeVisible();
    expect(
      screen.getByText("General knowledge · not your experience"),
    ).toBeVisible();
    expect(screen.getByText("Not in your matrix")).toBeVisible();
    expect(screen.getByText("Not added to your matrix.")).toBeVisible();
  });

  it("opens a matrix claim to its revision and verbatim quote, by keyboard", () => {
    show({ actions: [answerAction(withEveryKind())] });
    const chip = screen.getByRole("button", { name: /From your matrix/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Led a database migration/)).toBeNull();
    chip.focus();
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("“Led a database migration.”")).toBeVisible();
    expect(screen.getByText("Role 2 · revision 3")).toBeVisible();
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "false");
  });

  it("renders a draft that contains markup as plain text", () => {
    const hostile = answerResult({
      draft:
        '<img src="https://x.test/p.png" onerror="alert(1)"> [link](https://x.test)',
      claims: [],
    });
    show({ actions: [answerAction(hostile)] });
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("a[href='https://x.test']")).toBeNull();
    expect(
      screen.getByText(/<img src="https:\/\/x.test\/p.png"/),
    ).toBeVisible();
  });

  it("shows the withheld notice with the count when the server recorded it", () => {
    show({
      actions: [
        answerAction(
          { withheld: { rejectedClaimCount: 2, codes: ["unsupported_claim"] } },
          { dispatchStatus: "suppressed", suppressionReason: "invalid_output" },
        ),
      ],
    });
    expect(
      screen.getByText(
        "2 claims could not be checked against your approved experience, so no draft was shown.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Suggested answer")).toBeNull();
  });

  it("shows the withheld notice without a count when the server sent none", () => {
    show({
      actions: [
        answerAction(null, {
          dispatchStatus: "suppressed",
          suppressionReason: "invalid_output",
        }),
      ],
    });
    expect(screen.getByTestId("run-notice")).toHaveTextContent(
      "Draft withheld",
    );
    expect(screen.getByTestId("run-notice")).toHaveTextContent(
      "could not be checked against your approved experience, so no draft was shown",
    );
    expect(screen.getByTestId("run-notice")).not.toHaveTextContent(
      /\d claims?/,
    );
  });

  it("marks an answer for an earlier revision as outdated and keeps it visible", () => {
    show({
      actions: [
        answerAction(answerResult(), { taskRevision: 1 }),
        answerAction(null, {
          taskRevision: 2,
          dispatchStatus: "in_flight",
          createdAt: minutesAfter(1, 30),
          updatedAt: minutesAfter(1, 31),
        }),
      ],
    });
    expect(screen.getByTestId("stale-answer")).toHaveTextContent(
      "This answer was drafted for task rev 1. The task is now at rev 2",
    );
    expect(
      screen.getByText(/I led the migration at Example Corp/),
    ).toBeVisible();
  });

  it("copies the answer and announces it, and says so when it cannot", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    show({ actions: [answerAction(answerResult())] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy answer/ }));
    });
    expect(write).toHaveBeenCalledWith(
      "I led the migration at Example Corp and kept the service up.",
    );
    expect(
      screen
        .getAllByRole("status")
        .some((el) => el.textContent === "Copied answer"),
    ).toBe(true);

    write.mockRejectedValue(new Error("denied"));
    document.execCommand = vi.fn(() => false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy answer/ }));
    });
    expect(screen.getByText(/Couldn’t copy/)).toBeVisible();
    vi.unstubAllGlobals();
  });
});

describe("behavioural and logistics", () => {
  it("shows STAR sections, their claims, and the part the matrix cannot support", () => {
    show({ actions: [answerAction(starResult())] });
    expect(screen.getByText("Behavioural question")).toBeVisible();
    for (const heading of ["Situation", "Task", "Action", "Result"])
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    const task = screen.getByRole("region", { name: "Task" });
    expect(task).toHaveTextContent("doesn’t cover this part");
    const situation = screen.getByRole("region", { name: "Situation" });
    expect(
      within(situation).getByText("Mentored two junior developers."),
    ).toBeVisible();
    expect(
      within(situation).getByRole("button", {
        name: /From your matrix · Role 1/,
      }),
    ).toBeVisible();
  });

  it("shows what was found and what is missing for logistics", () => {
    show({ actions: [answerAction(logisticsResult())] });
    expect(screen.getByText("Logistics question")).toBeVisible();
    const found = screen.getByRole("region", { name: "What was found" });
    expect(found).toHaveTextContent("Notice period");
    expect(found).toHaveTextContent("My notice period is one month.");
    expect(
      within(found).getByRole("button", { name: /From your preferences/ }),
    ).toBeVisible();
    const missing = screen.getByRole("region", { name: "What is missing" });
    expect(missing).toHaveTextContent("Compensation");
    expect(missing).toHaveTextContent(
      "No matching approved preference line was found for these fields, even if this question did not ask about them.",
    );
    expect(missing).toHaveTextContent(
      "No matching approved preference line was found. Add it to your candidate context",
    );
  });
});
