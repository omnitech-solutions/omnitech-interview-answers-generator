import type { EngineState } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { MIC_MENU_TEXT, micMenu, micStatusOf } from "./mic-menu-model";

const engine = (
  microphone: EngineState["sources"]["microphone"],
  extra: Partial<EngineState> = {},
): EngineState => ({
  v: 1,
  pairing: "paired",
  listening: true,
  paused: false,
  sources: { microphone, "system-audio": "off", screen: "off" },
  lastHeardAgeSeconds: null,
  hint: null,
  ...extra,
});
const base = { micOn: false, held: false, pending: false };

describe("mic status transitions", () => {
  it("listens, mutes, loses and retries by the engine's report", () => {
    expect(
      micStatusOf({ ...base, state: engine("listening"), micOn: true }),
    ).toBe("listening");
    expect(micStatusOf({ ...base, state: engine("off") })).toBe("muted");
    expect(micStatusOf({ ...base, state: null })).toBe("muted");
    expect(micStatusOf({ ...base, state: engine("lost") })).toBe("lost");
    expect(
      micStatusOf({
        ...base,
        state: engine("lost", { microphoneRetryAttempt: 2 }),
      }),
    ).toBe("retrying");
    // The retry succeeded: back to listening, the attempt no longer counts.
    expect(
      micStatusOf({
        ...base,
        state: engine("listening", { microphoneRetryAttempt: 2 }),
        micOn: true,
      }),
    ).toBe("listening");
  });

  it("treats a bad attempt number as not retrying", () => {
    for (const attempt of [0, -1, Number.NaN]) {
      expect(
        micStatusOf({
          ...base,
          state: engine("lost", { microphoneRetryAttempt: attempt }),
        }),
      ).toBe("lost");
    }
  });
});

describe("mic menu", () => {
  it("offers Retry now only while lost or retrying", () => {
    const lost = micMenu({ ...base, state: engine("lost") });
    expect(lost.retry).toEqual({ label: "Retry now", enabled: true });
    expect(lost.statusLabel).toBe(MIC_MENU_TEXT.status.lost);
    const retrying = micMenu({
      ...base,
      state: engine("lost", { microphoneRetryAttempt: 3 }),
    });
    expect(retrying.attempt).toBe(3);
    expect(retrying.statusLabel).toBe("Retrying (attempt 3)");
    expect(retrying.retry?.enabled).toBe(true);
    expect(micMenu({ ...base, state: engine("off") }).retry).toBeNull();
    expect(
      micMenu({ ...base, micOn: true, state: engine("listening") }).retry,
    ).toBeNull();
  });

  it("disables Retry now while held or while a call is pending", () => {
    expect(
      micMenu({ ...base, held: true, state: engine("lost") }).retry?.enabled,
    ).toBe(false);
    expect(
      micMenu({ ...base, pending: true, state: engine("lost") }).retry?.enabled,
    ).toBe(false);
  });

  it("says why it is muted", () => {
    expect(
      micMenu({ ...base, state: engine("permission-denied") }).muteReason,
    ).toBe("denied");
    expect(micMenu({ ...base, state: engine("unavailable") }).muteReason).toBe(
      "unavailable",
    );
    expect(
      micMenu({ ...base, held: true, state: engine("off") }).muteReason,
    ).toBe("held");
    expect(micMenu({ ...base, state: engine("off") }).muteReason).toBeNull();
    expect(micMenu({ ...base, state: engine("lost") }).muteReason).toBeNull();
  });

  it("lists the system default first and checks the device in use", () => {
    const devices = [
      { id: "built-in", name: "MacBook Pro Microphone" },
      { id: "usb", name: "USB Mic" },
    ];
    const menu = micMenu({
      ...base,
      micOn: true,
      state: engine("listening", {
        microphoneDevices: devices,
        microphoneDeviceId: "usb",
      }),
    });
    expect(menu.canChooseDevice).toBe(true);
    expect(menu.selectedDeviceId).toBe("usb");
    expect(menu.devices).toEqual([
      { id: null, name: "System default", checked: false },
      { id: "built-in", name: "MacBook Pro Microphone", checked: false },
      { id: "usb", name: "USB Mic", checked: true },
    ]);
  });

  it("falls back to the system default for an unlisted or null device", () => {
    const state = engine("listening", {
      microphoneDevices: [{ id: "usb", name: "USB Mic" }],
      microphoneDeviceId: "gone",
    });
    expect(micMenu({ ...base, state }).selectedDeviceId).toBeNull();
    expect(micMenu({ ...base, state }).devices[0]?.checked).toBe(true);
  });

  it("does not offer a device choice from a shell that lists none", () => {
    const menu = micMenu({ ...base, state: engine("listening") });
    expect(menu.canChooseDevice).toBe(false);
    expect(menu.devices).toHaveLength(1);
  });
});
