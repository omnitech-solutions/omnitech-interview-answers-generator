import { negotiateStudioHost } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  capabilityLines,
  defaultHost,
  type HostFacts,
  macStatus,
} from "./setup-hosts";
import { capabilityReport } from "./testing/session-fixtures";

const noop = () => undefined;
const nativeHost = negotiateStudioHost({
  version: 1,
  hostKind: "native-macos",
  capabilities: ["capture-screen", "hotkeys"],
  captureScreen: noop,
  onHotkey: noop,
});

const browser = { dictation: true, screenShare: true };
const facts = (patch: Partial<HostFacts> = {}): HostFacts => ({
  native: null,
  report: null,
  browser,
  ...patch,
});
const stateOf = (lines: ReturnType<typeof capabilityLines>, id: string) =>
  lines.find((line) => line.id === id)?.state;

describe("host capability lines", () => {
  it("the bridge fixture is a real negotiated host", () => {
    expect(nativeHost).not.toBeNull();
  });

  it("Mac app inside the Mac app: capture and hotkeys are ok from the bridge", () => {
    const lines = capabilityLines("mac", facts({ native: nativeHost }));
    expect(stateOf(lines, "capture")).toBe("ok");
    expect(stateOf(lines, "window")).toBe("ok");
    expect(macStatus(nativeHost)).toEqual({
      text: "Running in this window",
      state: "ok",
    });
    expect(defaultHost(nativeHost)).toBe("mac");
  });

  it("Mac app card seen from a plain browser says it cannot know, never installed", () => {
    const lines = capabilityLines("mac", facts());
    expect(stateOf(lines, "capture")).toBe("unknown");
    expect(stateOf(lines, "window")).toBe("unknown");
    expect(stateOf(lines, "speech")).toBe("unknown");
    expect(lines.map((line) => line.text).join(" ")).not.toMatch(/installed/i);
    expect(macStatus(null)).toEqual({
      text: "Can’t tell from a browser",
      state: "unknown",
    });
    expect(defaultHost(null)).toBe("browser");
  });

  it("speech and permissions follow the companion's report", () => {
    const ready = capabilityLines("mac", facts({ report: capabilityReport() }));
    expect(stateOf(ready, "speech")).toBe("ok");
    expect(stateOf(ready, "permission-microphone")).toBe("ok");
    const bad = capabilityLines(
      "mac",
      facts({
        report: capabilityReport({
          speech: { onDeviceAvailable: false },
          permissions: { microphone: "denied", screen: "not-determined" },
        }),
      }),
    );
    expect(stateOf(bad, "speech")).toBe("no");
    expect(stateOf(bad, "permission-microphone")).toBe("no");
    expect(stateOf(bad, "permission-screen")).toBe("unknown");
  });

  it("browser card: dictation and screen follow the browser, app audio is never heard", () => {
    const lines = capabilityLines("browser", facts());
    expect(stateOf(lines, "dictation")).toBe("ok");
    expect(stateOf(lines, "screen")).toBe("ok");
    expect(lines.find((line) => line.id === "app-audio")).toMatchObject({
      text: "Can’t hear the other side",
      state: "no",
    });
    const none = capabilityLines(
      "browser",
      facts({ browser: { dictation: false, screenShare: false } }),
    );
    expect(stateOf(none, "dictation")).toBe("no");
    expect(stateOf(none, "screen")).toBe("no");
  });
});
