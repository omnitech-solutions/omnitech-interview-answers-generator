// The Setup host cards as data: the two places Studio can hear and see from,
// and the capability lines each card shows. Every line's state comes from a
// real fact passed in (the native bridge, the companion's last report, the
// browser's own abilities); what a fact cannot tell is "unknown", never a claim.
// Pure: no React, no reading of window, so each state is tested directly.
import type {
  LiveCompanionCapability,
  StudioHostCapability,
  StudioHostInfo,
} from "@omnitech/interview-contracts";
import { permissionLines, speechState } from "./companion-capability";
import type { SetupHost } from "./setup-model";

export type HostOption = {
  id: SetupHost;
  icon: "desktop_windows" | "devices";
  title: string;
  // Under the start button: what happens to the session once it starts.
  startNote: string;
};

export const HOST_OPTIONS: readonly HostOption[] = [
  {
    id: "mac",
    icon: "desktop_windows",
    title: "Mac app",
    // Verified in overlay/panels/auto-session.ts: a panel document that finds an
    // open session uses it, and starts one only when there is none.
    startNote:
      "Starts the session here. The Mac app window picks it up while it is open.",
  },
  {
    id: "browser",
    icon: "devices",
    title: "This browser only",
    startNote:
      "Asks once for your microphone, then listens. The screen is only shared when you press capture.",
  },
];

export type LineState = "ok" | "no" | "unknown";

export type CapabilityLine = {
  id: string;
  text: string;
  state: LineState;
};

export type BrowserAbilities = {
  dictation: boolean;
  screenShare: boolean;
};

export type HostFacts = {
  // The negotiated native bridge, or null in a plain browser.
  native: StudioHostInfo | null;
  // The companion's last report; null when none was read.
  report: LiveCompanionCapability | null;
  browser: BrowserAbilities;
};

const toState = (ok: boolean): LineState => (ok ? "ok" : "no");

// A native-only ability: known only from inside the Mac app's own window.
function nativeAbility(
  native: StudioHostInfo | null,
  ...names: StudioHostCapability[]
): LineState {
  if (!native) return "unknown";
  return toState(names.some((name) => native.capabilities.has(name)));
}

const NOT_KNOWN_HERE = " (known only inside the Mac app)";

function macLines({ native, report }: HostFacts): CapabilityLine[] {
  const speech = speechState(report);
  const lines: CapabilityLine[] = [
    {
      id: "speech",
      text: `Speech on this Mac: ${speech.label}`,
      state:
        speech.key === "ready" ? "ok" : speech.blocksSpeech ? "no" : "unknown",
    },
    ...permissionLines(report).map(
      (line): CapabilityLine => ({
        id: `permission-${line.source}`,
        text: `${line.label}: ${line.text}`,
        state:
          line.state === "granted"
            ? "ok"
            : line.state === "denied"
              ? "no"
              : "unknown",
      }),
    ),
  ];
  const capture = nativeAbility(native, "capture-screen");
  const window = nativeAbility(native, "hotkeys", "pin-on-top");
  lines.push(
    {
      id: "capture",
      text: `Sees the screen, no share picker${capture === "unknown" ? NOT_KNOWN_HERE : ""}`,
      state: capture,
    },
    {
      id: "window",
      text: `Floating window with hotkeys${window === "unknown" ? NOT_KNOWN_HERE : ""}`,
      state: window,
    },
  );
  return lines;
}

function browserLines({ browser }: HostFacts): CapabilityLine[] {
  return [
    {
      id: "dictation",
      text: browser.dictation
        ? "Hears you (browser dictation)"
        : "Can’t hear you: this browser has no dictation",
      state: toState(browser.dictation),
    },
    // A page cannot capture the audio another app or tab plays.
    { id: "app-audio", text: "Can’t hear the other side", state: "no" },
    {
      id: "screen",
      text: browser.screenShare
        ? "Sees the screen after a share click"
        : "Can’t share the screen: this browser has no screen sharing",
      state: toState(browser.screenShare),
    },
  ];
}

export function capabilityLines(
  host: SetupHost,
  facts: HostFacts,
): CapabilityLine[] {
  return host === "mac" ? macLines(facts) : browserLines(facts);
}

// The Mac card's own status. A plain browser cannot know the app is installed,
// so it says that instead of "Installed" or "Not installed".
export function macStatus(native: StudioHostInfo | null): {
  text: string;
  state: LineState;
} {
  return native
    ? { text: "Running in this window", state: "ok" }
    : { text: "Can’t tell from a browser", state: "unknown" };
}

// The host this page can tell it is in; a plain browser starts as the browser.
export const defaultHost = (native: StudioHostInfo | null): SetupHost =>
  native ? "mac" : "browser";
