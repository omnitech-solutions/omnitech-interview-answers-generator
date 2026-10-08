// Settings › Call audio: shown only when the shell offers it, saved through the
// account bridge, and honest about what is really carrying the call's audio.
import type {
  AccountCallAudio,
  AccountPermissions,
} from "@omnitech/interview-contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CallAudioSetting } from "./call-audio-setting";
import { callAudioNote } from "./start-model";

const report = (extra: Partial<AccountCallAudio> = {}): AccountCallAudio => ({
  selected: "screenCaptureKit",
  active: "screenCaptureKit",
  permission: "granted",
  tapSupported: true,
  ...extra,
});

function bridge(callAudio: AccountCallAudio | undefined, withSetter = true) {
  const permissions = (next = callAudio): AccountPermissions => ({
    microphone: "granted",
    screen: "granted",
    ...(next ? { callAudio: next } : {}),
  });
  const setCallAudio = vi.fn(async (source: string) =>
    source === "processTap"
      ? permissions(
          report({
            selected: "processTap",
            active: "processTap",
            permission: "undetermined",
          }),
        )
      : null,
  );
  (window as { studioHost?: unknown }).studioHost = {
    version: 1,
    hostKind: "native-macos",
    capabilities: ["account"],
    captureScreen: async () => ({ ok: false, reason: "unsupported" }),
    pinOnTop: async () => true,
    openExternal: async () => undefined,
    onHotkey: () => () => undefined,
    account: {
      signIn: async () => true,
      cancelSignIn: async () => undefined,
      reopenSignIn: async () => true,
      copySignInLink: async () => true,
      signOut: async () => true,
      state: () => ({ phase: "idle" }),
      onState: () => () => undefined,
      permissions: async () => permissions(),
      ...(withSetter ? { setCallAudio } : {}),
    },
  };
  return setCallAudio;
}

afterEach(() => {
  cleanup();
  delete (window as { studioHost?: unknown }).studioHost;
});

describe("Settings › Call audio", () => {
  it("shows nothing in a browser or on a shell that does not offer the choice", async () => {
    const { container } = render(<CallAudioSetting />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    bridge(undefined);
    render(<CallAudioSetting />);
    await Promise.resolve();
    expect(screen.queryByTestId("pn-call-audio-select")).toBeNull();
    cleanup();
    bridge(report(), false);
    render(<CallAudioSetting />);
    await Promise.resolve();
    expect(screen.queryByTestId("pn-call-audio-select")).toBeNull();
  });

  it("defaults to screen capture, with both plainly labelled choices", async () => {
    bridge(report());
    render(<CallAudioSetting />);
    const select = await screen.findByTestId("pn-call-audio-select");
    expect(select).toHaveValue("screenCaptureKit");
    expect(
      screen.getByRole("option", {
        name: "Screen capture (shows the sharing indicator)",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", {
        name: "System audio tap (macOS 14.4+, no sharing indicator)",
      }),
    ).toBeEnabled();
    expect(screen.getByTestId("pn-call-audio-note")).toHaveTextContent(
      "Currently Sharing",
    );
  });

  it("saves the tap through the shell and shows what the shell answered", async () => {
    const setCallAudio = bridge(report());
    render(<CallAudioSetting />);
    const select = await screen.findByTestId("pn-call-audio-select");
    fireEvent.change(select, { target: { value: "processTap" } });
    await waitFor(() => expect(select).toHaveValue("processTap"));
    expect(setCallAudio).toHaveBeenCalledWith("processTap");
    expect(screen.getByTestId("pn-call-audio-note")).toHaveTextContent(
      "System Audio Recording",
    );
  });

  it("keeps the choice when the shell refuses, and cannot choose the tap on an older macOS", async () => {
    const setCallAudio = bridge(
      report({ selected: "processTap", active: "processTap" }),
    );
    render(<CallAudioSetting />);
    const select = await screen.findByTestId("pn-call-audio-select");
    fireEvent.change(select, { target: { value: "screenCaptureKit" } });
    await waitFor(() => expect(setCallAudio).toHaveBeenCalled());
    expect(select).toHaveValue("processTap");
    cleanup();
    bridge(report({ tapSupported: false }));
    render(<CallAudioSetting />);
    await screen.findByTestId("pn-call-audio-select");
    expect(
      screen.getByRole("option", { name: /System audio tap/ }),
    ).toBeDisabled();
  });

  it("says when the chosen tap is not what carries the call's audio", () => {
    expect(
      callAudioNote(report({ selected: "processTap", tapSupported: false })),
    ).toContain("older than 14.4");
    expect(callAudioNote(report({ selected: "processTap" }))).toContain(
      "could not run",
    );
    expect(
      callAudioNote(report({ selected: "processTap", active: "processTap" })),
    ).toContain("No sharing indicator");
  });
});
