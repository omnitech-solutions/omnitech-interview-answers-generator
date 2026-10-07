import { afterEach, describe, expect, it } from "vitest";
import {
  noteCaptureResult,
  noteSource,
  resetCaptureSource,
} from "./host-display";
import {
  noteCaptureProblemReason,
  noteScreenProblem,
  reduceScreenProblems,
  resetScreenProblems,
  SCREEN_PROBLEM_COPY,
  type ScreenProblemKind,
  screenProblemKindOf,
  screenProblemKindsNow,
  screenProblemsOf,
} from "./screen-problems";

const run = (
  events: Parameters<typeof reduceScreenProblems>[1][],
  from: readonly ScreenProblemKind[] = [],
) => events.reduce(reduceScreenProblems, from);

afterEach(() => {
  resetScreenProblems();
  resetCaptureSource();
});

describe("screen problem state", () => {
  it("keeps a problem until it is resolved, without duplicating it", () => {
    const once = run([{ kind: "problem", problem: "permission-missing" }]);
    expect(once).toEqual(["permission-missing"]);
    expect(
      reduceScreenProblems(once, {
        kind: "problem",
        problem: "permission-missing",
      }),
    ).toBe(once);
  });

  it("orders problems the same way however they arrived", () => {
    expect(
      run([
        { kind: "problem", problem: "capture-failed" },
        { kind: "problem", problem: "permission-missing" },
      ]),
    ).toEqual(["permission-missing", "capture-failed"]);
  });

  it("ends the right problems on each resolution", () => {
    const all = run([
      { kind: "problem", problem: "permission-missing" },
      { kind: "problem", problem: "display-disconnected" },
      { kind: "problem", problem: "capture-failed" },
    ]);
    expect(reduceScreenProblems(all, { kind: "display-chosen" })).toEqual([
      "permission-missing",
    ]);
    expect(reduceScreenProblems(all, { kind: "permission-granted" })).toEqual([
      "display-disconnected",
      "capture-failed",
    ]);
    expect(reduceScreenProblems(all, { kind: "capture-ok" })).toEqual([]);
    // Nothing to resolve: the same array comes back.
    expect(reduceScreenProblems([], { kind: "capture-ok" })).toEqual([]);
  });

  it("gives each problem a fix action", () => {
    expect(SCREEN_PROBLEM_COPY["permission-missing"].fix).toEqual({
      id: "open-system-settings",
      label: "Open System Settings",
    });
    expect(SCREEN_PROBLEM_COPY["display-disconnected"].fix).toEqual({
      id: "pick-display",
      label: "Pick display",
    });
    expect(screenProblemsOf(["capture-failed"])[0]?.fix.id).toBe(
      "pick-display",
    );
  });

  it("maps only screen-setup capture reasons", () => {
    expect(screenProblemKindOf("permission-denied")).toBe("permission-missing");
    expect(screenProblemKindOf("capture-failed")).toBe("capture-failed");
    expect(screenProblemKindOf("timeout")).toBe("capture-failed");
    expect(screenProblemKindOf("display-changed")).toBe("display-disconnected");
    expect(screenProblemKindOf("busy")).toBeNull();
    expect(screenProblemKindOf("session-paused")).toBeNull();
    expect(screenProblemKindOf("no-focused-window")).toBeNull();
  });
});

describe("screen problems from the app's own events", () => {
  it("survives the banner and ends on a good capture", () => {
    noteCaptureProblemReason("permission-denied");
    noteCaptureProblemReason("busy");
    expect(screenProblemKindsNow()).toEqual(["permission-missing"]);
    noteSource({ kind: "capture", pinned: false });
    expect(screenProblemKindsNow()).toEqual([]);
  });

  it("raises the display problem when a pin drops and ends it on a new choice", () => {
    noteSource({
      kind: "capture",
      pinned: true,
      pinFallback: "display-unavailable",
    });
    // A dropped pin is raised on the capture that reported it, and the same
    // capture's frame is not a failure to resolve it: it stays.
    expect(screenProblemKindsNow()).toEqual(["display-disconnected"]);
    noteSource({ kind: "select", result: { ok: true, pinned: false } });
    expect(screenProblemKindsNow()).toEqual([]);
    noteSource({
      kind: "select",
      result: { ok: false, reason: "display-unavailable" },
    });
    expect(screenProblemKindsNow()).toEqual(["display-disconnected"]);
  });

  it("clears on a successful capture result", () => {
    noteScreenProblem({ kind: "problem", problem: "capture-failed" });
    noteCaptureResult({
      ok: true,
      base64: "",
      mediaType: "image/jpeg",
    } as never);
    expect(screenProblemKindsNow()).toEqual([]);
  });
});
