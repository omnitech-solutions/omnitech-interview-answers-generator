import { afterEach, describe, expect, it, vi } from "vitest";
import { openSessionSummary } from "./summary-link";

const SESSION = "0b1f6a52-7c7e-4f0e-9e1b-2c3d4e5f6a7b";

afterEach(() => {
  delete (window as { studioHost?: unknown }).studioHost;
  vi.restoreAllMocks();
});

describe("opening a session's summary", () => {
  it("hands the Studio address of the ended page to the shell's openExternal", () => {
    window.history.replaceState({}, "", "/t/local/p/interview/live/overlay");
    const openExternal = vi.fn(async () => undefined);
    (window as { studioHost?: unknown }).studioHost = {
      version: 1,
      hostKind: "native-macos",
      capabilities: ["open-external"],
      captureScreen: async () => ({ ok: false }),
      pinOnTop: async () => false,
      openExternal,
      onHotkey: () => () => undefined,
    };
    openSessionSummary(SESSION);
    expect(openExternal).toHaveBeenCalledWith(
      `${window.location.origin}/t/local/p/interview/live/${SESSION}`,
    );
  });

  it("falls back to the card's own navigation when there is no shell: a Studio tab, else a new one", () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/t/local/p/interview/live/overlay");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openSessionSummary(SESSION);
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining(`/live/${SESSION}`),
      "_blank",
      "noopener",
    );
  });
});
