import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHandsFreeChoice } from "../hands-free-choice";
import { autoLine } from "./auto-line";
import { DeviceOnlyCard, deviceOnlyNotice } from "./device-only-notice";

const base = {
  deviceOnly: true,
  autoOn: true,
  engine: false,
  dictationError:
    "Device-only mode needs on-device dictation, and it isn’t available for your language in this browser, so dictation is off. Type the follow-up instead.",
  dictationSupported: true,
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("device-only notice", () => {
  it("is one card carrying the dictation fact once, only for device-only with Auto on", () => {
    expect(deviceOnlyNotice({ ...base, deviceOnly: false })).toBeNull();
    expect(deviceOnlyNotice({ ...base, autoOn: false })).toBeNull();
    render(<DeviceOnlyCard input={base} tenant="t" onStartRemote={vi.fn()} />);
    const card = screen.getByTestId("device-only-card");
    expect(card.textContent?.match(/on-device dictation/g)).toHaveLength(1);
    expect(card).toHaveTextContent("Screenshots are not analysed");
  });

  it("the Auto line repeats none of it", () => {
    const line = autoLine({
      open: true,
      paused: false,
      ownerPaused: false,
      resumeFailed: false,
      micDenied: false,
      micUnsupported: true,
      micError: base.dictationError,
      listening: false,
      heardAgoMs: null,
      wantsScreen: true,
      deviceOnly: true,
      sharing: false,
      watchable: true,
      block: null,
    });
    expect(line?.text).not.toMatch(/dictation|device-only|screen|can’t listen/);
  });

  it("with the native engine, no missing-dictation message appears", () => {
    const notice = deviceOnlyNotice({ ...base, engine: true });
    expect(notice?.off.join(" ")).toMatch(/native engine/);
    expect(notice?.off.join(" ")).not.toMatch(/Type the follow-up/);
    const line = autoLine({
      open: true,
      paused: false,
      ownerPaused: false,
      resumeFailed: false,
      micDenied: false,
      micUnsupported: true,
      micError: null,
      listening: false,
      heardAgoMs: null,
      wantsScreen: false,
      deviceOnly: false,
      sharing: false,
      watchable: true,
      block: null,
      engine: true,
    });
    expect(line?.tone).toBe("ok");
  });

  it("the button remembers Allow remote and only opens Setup", () => {
    const open = vi.fn();
    render(<DeviceOnlyCard input={base} tenant="t" onStartRemote={open} />);
    fireEvent.click(screen.getByTestId("device-only-remote"));
    expect(loadHandsFreeChoice("t")).toBe("permitted-remote");
    expect(open).toHaveBeenCalledTimes(1);
  });
});
