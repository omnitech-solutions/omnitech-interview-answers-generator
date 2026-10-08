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

  // The library Select: the trigger carries the test id and shows the chosen
  // label; its options are `<testid>-option-<value>` once it is open.
  const option = (value: string) =>
    screen.getByTestId(`pn-call-audio-select-option-${value}`);

  it("defaults to screen capture, with both plainly labelled choices", async () => {
    bridge(report());
    render(<CallAudioSetting />);
    const select = await screen.findByTestId("pn-call-audio-select");
    expect(select).toHaveTextContent(
      "Screen capture (shows the sharing indicator)",
    );
    fireEvent.click(select);
    expect(option("screenCaptureKit")).toHaveTextContent(
      "Screen capture (shows the sharing indicator)",
    );
    expect(option("processTap")).toHaveTextContent(
      "System audio tap (macOS 14.4+, no sharing indicator)",
    );
    expect(option("processTap")).not.toHaveAttribute("data-disabled", "true");
    expect(screen.getByTestId("pn-call-audio-note")).toHaveTextContent(
      "Currently Sharing",
    );
  });

  it("saves the tap through the shell and shows what the shell answered", async () => {
    const setCallAudio = bridge(report());
    render(<CallAudioSetting />);
    const select = await screen.findByTestId("pn-call-audio-select");
    fireEvent.click(select);
    fireEvent.click(option("processTap"));
    await waitFor(() => expect(select).toHaveTextContent("System audio tap"));
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
    fireEvent.click(select);
    fireEvent.click(option("screenCaptureKit"));
    await waitFor(() => expect(setCallAudio).toHaveBeenCalled());
    expect(select).toHaveTextContent("System audio tap");
    cleanup();
    bridge(report({ tapSupported: false }));
    render(<CallAudioSetting />);
    fireEvent.click(await screen.findByTestId("pn-call-audio-select"));
    expect(option("processTap")).toHaveAttribute("data-disabled", "true");
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
