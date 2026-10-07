import { describe, expect, it } from "vitest";
import {
  canApply,
  EMPTY_TRAY,
  effectiveIntent,
  MAX_STAGED_IMAGES,
  type StagedShot,
  sendsLine,
  TRAY_FAILURE_TEXT,
  TRAY_FAILURES,
  type TrayEvent,
  type TrayState,
  trayFailureOf,
  trayOpen,
  trayReducer,
} from "./screenshot-tray";

const shot = (id: string): StagedShot => ({
  id,
  blob: new Blob([id]),
  label: "This Mac",
  display: null,
  at: 0,
});
const run = (events: TrayEvent[], from: TrayState = EMPTY_TRAY): TrayState =>
  events.reduce(trayReducer, from);
const ids = (state: TrayState) => state.items.map((item) => item.id);

describe("staging", () => {
  it("stages in order and opens the tray", () => {
    const state = run([
      { type: "stage", shot: shot("a") },
      { type: "stage", shot: shot("b") },
    ]);
    expect(ids(state)).toEqual(["a", "b"]);
    expect(state.open).toBe(true);
  });

  it("lets the first image decide the intent and later ones keep it", () => {
    const state = run([
      { type: "stage", shot: shot("a"), intent: "new" },
      { type: "stage", shot: shot("b"), intent: "add" },
    ]);
    expect(state.intent).toBe("new");
  });

  it(`refuses a ${MAX_STAGED_IMAGES + 1}th image with image_count and keeps the four`, () => {
    const events: TrayEvent[] = Array.from(
      { length: MAX_STAGED_IMAGES + 1 },
      (_, n) => ({ type: "stage", shot: shot(`s${n}`) }),
    );
    const state = run(events);
    expect(state.items).toHaveLength(MAX_STAGED_IMAGES);
    expect(state.failure).toBe("image_count");
  });

  it("removes, and a removal leaves the order of the rest", () => {
    const state = run([
      { type: "stage", shot: shot("a") },
      { type: "stage", shot: shot("b") },
      { type: "stage", shot: shot("c") },
      { type: "remove", id: "b" },
    ]);
    expect(ids(state)).toEqual(["a", "c"]);
  });

  it("moves one step at a time and stops at the ends", () => {
    const base = run([
      { type: "stage", shot: shot("a") },
      { type: "stage", shot: shot("b") },
      { type: "stage", shot: shot("c") },
    ]);
    expect(ids(run([{ type: "move", id: "c", by: -1 }], base))).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(ids(run([{ type: "move", id: "a", by: -1 }], base))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(ids(run([{ type: "move", id: "c", by: 1 }], base))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("a crop replaces the bytes with the NEW blob and keeps the place", () => {
    const base = run([
      { type: "stage", shot: shot("a") },
      { type: "stage", shot: shot("b") },
    ]);
    const cropped = new Blob(["cropped"]);
    const state = run([{ type: "crop", id: "a", blob: cropped }], base);
    expect(state.items[0]?.blob).toBe(cropped);
    expect(state.items[0]?.blob).not.toBe(base.items[0]?.blob);
    expect(ids(state)).toEqual(["a", "b"]);
  });

  it("discard empties the tray and returns it to its default", () => {
    const state = run([
      { type: "stage", shot: shot("a"), intent: "new" },
      { type: "discard" },
    ]);
    expect(state).toEqual(EMPTY_TRAY);
  });
});

describe("apply", () => {
  const staged = run([{ type: "stage", shot: shot("a") }]);

  it("marks the request in flight and refuses every edit meanwhile", () => {
    const state = run([{ type: "apply", requestId: "r1" }], staged);
    expect(state.applying).toBe(true);
    for (const event of [
      { type: "stage", shot: shot("b") },
      { type: "remove", id: "a" },
      { type: "intent", intent: "new" },
    ] satisfies TrayEvent[])
      expect(trayReducer(state, event)).toBe(state);
  });

  it("reuses the request id for a retry and makes a new one after any edit", () => {
    const first = run([{ type: "apply", requestId: "r1" }], staged);
    const failed = run([{ type: "failed", failure: "request" }], first);
    expect(failed.requestId).toBe("r1");
    const retry = run([{ type: "apply", requestId: "r2" }], failed);
    expect(retry.requestId).toBe("r1");
    const edited = run(
      [{ type: "crop", id: "a", blob: new Blob(["x"]) }],
      failed,
    );
    expect(edited.requestId).toBeNull();
    expect(edited.failure).toBeNull();
    expect(run([{ type: "apply", requestId: "r2" }], edited).requestId).toBe(
      "r2",
    );
  });

  it("discard and reset stay legal while applying, and a late terminal event of that request is ignored", () => {
    const applying = run([{ type: "apply", requestId: "r1" }], staged);
    for (const type of ["discard", "reset"] as const)
      expect(trayReducer(applying, { type })).toEqual(EMPTY_TRAY);
    const reset = trayReducer(applying, { type: "reset" });
    const next = run(
      [
        { type: "stage", shot: shot("z") },
        { type: "apply", requestId: "r2" },
        { type: "failed", failure: "request", requestId: "r1" },
        { type: "applied", requestId: "r1" },
      ],
      reset,
    );
    expect(next.applying).toBe(true);
    expect(ids(next)).toEqual(["z"]);
  });

  it("a definite refusal drops the request id; only an unknown failure keeps it", () => {
    const refused = run(
      [
        { type: "apply", requestId: "r1" },
        { type: "failed", failure: "stale_target", requestId: "r1" },
      ],
      staged,
    );
    expect(refused.requestId).toBeNull();
  });

  it("success empties the tray; failure keeps the images and says why", () => {
    const sent = run(
      [{ type: "apply", requestId: "r1" }, { type: "applied" }],
      staged,
    );
    expect(sent).toEqual(EMPTY_TRAY);
    const failed = run(
      [
        { type: "apply", requestId: "r1" },
        { type: "failed", failure: "stale_target" },
      ],
      staged,
    );
    expect(ids(failed)).toEqual(["a"]);
    expect(failed.applying).toBe(false);
    expect(failed.failure).toBe("stale_target");
  });
});

describe("rules", () => {
  it("is closed by default in both modes until something is staged, and an explicit choice wins", () => {
    expect(trayOpen(EMPTY_TRAY, "manual")).toBe(false);
    expect(trayOpen(EMPTY_TRAY, "auto")).toBe(false);
    expect(trayOpen({ ...EMPTY_TRAY, items: [shot("a")] }, "manual")).toBe(
      true,
    );
    const staged = run([
      { type: "stage", shot: shot("a") },
      { type: "open", open: false },
    ]);
    expect(trayOpen(staged, "manual")).toBe(false);
    expect(trayOpen({ ...EMPTY_TRAY, items: [shot("a")] }, "auto")).toBe(true);
  });

  it("Apply needs an image, or a task to regenerate; never while sending; never device-only with images", () => {
    const withImage = run([{ type: "stage", shot: shot("a") }]);
    expect(
      canApply({ state: EMPTY_TRAY, hasTarget: false, deviceOnly: false }),
    ).toBe(false);
    expect(
      canApply({ state: EMPTY_TRAY, hasTarget: true, deviceOnly: false }),
    ).toBe(true);
    expect(
      canApply({
        state: { ...EMPTY_TRAY, intent: "new" },
        hasTarget: true,
        deviceOnly: false,
      }),
    ).toBe(false);
    expect(
      canApply({ state: withImage, hasTarget: false, deviceOnly: false }),
    ).toBe(true);
    expect(
      canApply({ state: withImage, hasTarget: false, deviceOnly: true }),
    ).toBe(false);
    expect(
      canApply({
        state: { ...withImage, applying: true },
        hasTarget: true,
        deviceOnly: false,
      }),
    ).toBe(false);
  });

  it("with no task the tray is always a new problem", () => {
    expect(effectiveIntent(EMPTY_TRAY, false)).toBe("new");
    expect(effectiveIntent(EMPTY_TRAY, true)).toBe("add");
  });

  it("says what Apply sends, and that device-only sends none", () => {
    expect(sendsLine(2, false)).toBe(
      "Sends 2 screenshots and the text read from them.",
    );
    expect(sendsLine(1, false)).toBe(
      "Sends 1 screenshot and the text read from it.",
    );
    expect(sendsLine(0, false)).toMatch(/regenerates without new context/);
    expect(sendsLine(1, true)).toMatch(/no screenshot leaves this device/);
  });

  it.each(TRAY_FAILURES.filter((reason) => reason !== "request"))(
    "maps the server reason %s to its own words",
    (reason) => {
      const failure = trayFailureOf({ code: "invalid_input", reason });
      expect(failure).toBe(reason);
      expect(TRAY_FAILURE_TEXT[failure]).not.toBe(TRAY_FAILURE_TEXT.request);
    },
  );

  it("anything else is a retryable request failure", () => {
    expect(trayFailureOf({ code: "network" })).toBe("request");
    expect(trayFailureOf({ code: "invalid_input", reason: "target" })).toBe(
      "request",
    );
  });
});
