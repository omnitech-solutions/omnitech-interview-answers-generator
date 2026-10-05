import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionView } from "./testing/session-fixtures";

afterEach(() => {
  vi.resetModules();
  window.sessionStorage.clear();
});

// The store re-hydrates the ended session after a reload, so the memory of
// which run ids were saved has to survive one too, or the next save re-sends a
// run id the server already derived and refuses.
describe("saved rehearsal run ids", () => {
  it("are remembered after a reload of the page", async () => {
    const first = await import("./rehearsal-run-link");
    const session = sessionView({ rehearsalRunId: "run-1", status: "ended" });
    expect(first.linkRehearsalRun(session, false).kind).toBe("linked");
    first.markRehearsalRunSaved("run-1");

    // A reload: module memory is gone, the tab's sessionStorage is not.
    vi.resetModules();
    const reloaded = await import("./rehearsal-run-link");
    expect(reloaded.linkRehearsalRun(session, false)).toEqual({
      kind: "none",
    });
  });

  it("are forgotten on request, in memory and in storage", async () => {
    const link = await import("./rehearsal-run-link");
    link.markRehearsalRunSaved("run-1");
    link.forgetSavedRehearsalRuns();
    vi.resetModules();
    const reloaded = await import("./rehearsal-run-link");
    expect(
      reloaded.linkRehearsalRun(
        sessionView({ rehearsalRunId: "run-1", status: "ended" }),
        false,
      ).kind,
    ).toBe("linked");
  });

  it("still work when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const link = await import("./rehearsal-run-link");
    expect(() => link.markRehearsalRunSaved("run-1")).not.toThrow();
    expect(
      link.linkRehearsalRun(
        sessionView({ rehearsalRunId: "run-1", status: "ended" }),
        false,
      ).kind,
    ).toBe("none");
    vi.restoreAllMocks();
  });
});
