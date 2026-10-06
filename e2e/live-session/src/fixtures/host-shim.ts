// The native host shim: a RECORDING stand-in for the `window.studioHost`
// bridge the macOS shell injects into its WKWebView (HostBridge.swift, contract
// in packages/interview-contracts/src/studio-host.ts). The page under test is
// the real overlay route, loaded as the shell loads it (`?host=native&panel=...`);
// only the bridge is simulated, and every call the page makes lands in a log the
// spec asserts on, in the wire shape the Swift decoder accepts: one entry
// `{ method, params }`, with the presentation operations as
// `{ method: "presentation", params: { op, ... } }`.
//
// It enforces the decoder's parameter rules for the calls it models (window
// size, app mode, hit regions, capture requests, external addresses): a call the
// Swift decoder would refuse REJECTS here too, is kept out of `calls()` and is
// listed by `rejected()`. Not ported: `screenWatchStart` parameter checks.
//
// What it cannot be: ScreenCaptureKit, Apple Vision, Carbon hotkeys, real window
// geometry. Those stay in the manual/AX checklist (plan.md 7.7, README "what
// Playwright cannot prove"). The Vision path is only a stub here: it proves the
// page's use of the `text-recognition` capability, not Vision's output.
import type { BrowserContext, Page } from "@playwright/test";

export type HostCall = {
  method: string;
  // The `op` of a presentation call, else null.
  op: string | null;
  params: Record<string, unknown>;
};

export type ShimOptions = {
  // Capabilities the fake shell advertises (default: the real shell's list when
  // Vision answers, `text-recognition` included).
  capabilities?: string[];
  // false: a shell where Vision is unavailable: `text-recognition` is not
  // advertised (the page falls back to its in-page engine) and `recognizeText`
  // answers `unavailable`. Applies to the default capability list.
  textRecognition?: boolean;
  // Presentation capabilities (default: the real shell's list).
  presentationCapabilities?: string[];
  // Omit the hands-free engine (the real shell embeds one).
  engine?: boolean;
  // Offer the shell's optional `consent` bridge (`granted()`, `open()`): the page
  // reads it for the one-time consent. Absent by default, like the Swift shell,
  // which sets a `studio.shell.consented` flag in the page instead.
  consent?: boolean;
  // `presentation.nativeToasts`: true (the real shell) means the shell draws
  // toasts itself, so the page draws none. False lets a spec read the page's own
  // toast ("The pinned display was disconnected...").
  nativeToasts?: boolean;
};
type InstalledOptions = Required<Omit<ShimOptions, "consent">> &
  Pick<ShimOptions, "consent">;

// Runs in the page, before any page script. Plain JS: it is serialised by
// Playwright, so it may not reference anything outside itself.
function installShim(options: InstalledOptions): void {
  type Json = Record<string, unknown>;
  const calls: Array<{ method: string; op: string | null; params: Json }> = [];
  // Calls the Swift decoder would refuse (the promise rejects; the shell never
  // acts on them).
  const rejected: Array<{ method: string; params: Json; reason: string }> = [];
  const hotkeyListeners: Array<(name: string) => void> = [];
  const modeListeners: Array<(on: boolean) => void> = [];
  type Display = { id: number; name: string; index: number; count: number };
  const watchListeners: Array<
    (event: { at: number; bits: number; display?: Display }) => void
  > = [];
  const engineListeners: Array<(state: unknown) => void> = [];
  const refused = new Set<string>();
  const state = {
    interactive: true,
    mode: "expanded",
    visible: true,
    settingsOpen: false,
    windowSize: null as { width: number; height?: number } | null,
    pinned: false,
    watching: false,
    captureResult: null as unknown,
    // D35: the `ocr` block (with optional `metrics`) the default capture carries.
    captureOcr: null as unknown,
    // The answer `recognizeText` gives (null: a blank frame, no text).
    recognizeResult: null as unknown,
    captureCount: 0,
    // Eight row flags (true: that row brightens left to right) that make the
    // default capture a frame with a KNOWN difference hash: each row is one
    // 8-bit byte of the page's 9x8 dHash (ascending = bits set, descending =
    // clear), so flipping k rows moves the hash by 8k bits. null: the drawn page.
    framePattern: null as boolean[] | null,
    // The last hit regions the page reported (null: interactive everywhere).
    hitRegions: null as unknown[] | null,
    // What each default capture was: the display it came from and the first
    // 8 hex characters of its sha-256 (the same digest the control API records
    // for an image the model received), so a spec can tell which image is which.
    captured: [] as Array<{ n: number; display: string; digest: string }>,
    // Two displays by default; the pin is a display id or null (follow the browser).
    displays: [
      { id: 1, name: "Built-in Retina Display", index: 1, count: 2 },
      { id: 2, name: "DELL U2723QE", index: 2, count: 2 },
    ] as Display[],
    pinnedDisplay: null as number | null,
    // A pin dropped because its display went away is reported once, as the shell does.
    pinFallbackPending: false,
  };
  // The display the next frame is "from": the pinned one, else the first.
  const currentDisplay = (): Display | undefined =>
    state.displays.find((d) => d.id === state.pinnedDisplay) ??
    state.displays[0];
  const engineState = (listening: boolean, paused = false) => ({
    v: 1,
    pairing: "paired",
    listening,
    paused,
    sources: {
      microphone: listening ? "listening" : "off",
      "system-audio": listening ? "listening" : "off",
      screen: listening ? "listening" : "off",
    },
    lastHeardAgeSeconds: null,
    hint: null,
  });
  let engineCurrent = engineState(false);
  let engineRefusal: string | null = null;

  // The decoder's refusal: HostCallError.invalidParameters. Recorded apart from
  // `calls`, and thrown so the page's promise rejects as the shell's does.
  const refuse = (method: string, params: Json, reason: string): never => {
    rejected.push({ method, params: { ...params }, reason });
    throw new Error(`invalid-parameters: ${method}: ${reason}`);
  };
  const isNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const isUint32 = (value: unknown): value is number =>
    isNumber(value) &&
    value >= 0 &&
    value <= 4294967295 &&
    value === Math.round(value);
  const keysWithin = (value: Json, allowed: string[]): boolean =>
    Object.keys(value).every((key) => allowed.includes(key));
  const SCREEN_RECORDING_SETTINGS =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
  const MICROPHONE_SETTINGS =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

  const record = (method: string, params: Json = {}) => {
    const op = method === "presentation" ? String(params["op"]) : null;
    calls.push({ method, op, params });
    return op ?? method;
  };

  // A real JPEG, drawn at call time so each capture differs (the page's change
  // detection and the server's dedupe see distinct frames).
  const jpeg = (label: string): string => {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 600;
    const context = canvas.getContext("2d");
    if (context && state.framePattern) {
      const band = canvas.height / 8;
      state.framePattern.forEach((ascending, row) => {
        const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
        gradient.addColorStop(0, ascending ? "#202020" : "#e0e0e0");
        gradient.addColorStop(1, ascending ? "#e0e0e0" : "#202020");
        context.fillStyle = gradient;
        context.fillRect(0, row * band, canvas.width, band);
      });
      // A 2x2 mark that differs per capture: new bytes every time, no change to
      // the hash (a 9x8 average does not see 4 pixels).
      context.fillStyle = `rgb(${state.captureCount % 256},0,0)`;
      context.fillRect(0, 0, 2, 2);
    } else if (context) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 960, 600);
      context.fillStyle = "#111111";
      context.font = "28px sans-serif";
      context.fillText("Sliding Window Rate Limiter", 40, 80);
      context.font = "20px sans-serif";
      context.fillText(
        "Design a rate limiter: at most N requests per",
        40,
        130,
      );
      context.fillText("client in any sliding window of W seconds.", 40, 160);
      context.fillText(label, 40, 560);
    }
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
  };

  const presentationOp = async (
    name: string,
    params: Json = {},
    apply?: () => void,
  ): Promise<boolean> => {
    record("presentation", { op: name, ...params });
    if (refused.has(name)) return false;
    apply?.();
    return true;
  };

  const presentation = Object.freeze({
    capabilities: Object.freeze([...options.presentationCapabilities]),
    nativeToasts: options.nativeToasts,
    quit: () => presentationOp("quit"),
    openSettings: () =>
      presentationOp("openSettings", {}, () => {
        state.settingsOpen = true;
      }),
    closeSettings: () =>
      presentationOp("closeSettings", {}, () => {
        state.settingsOpen = false;
      }),
    setVisible: (visible: unknown) =>
      presentationOp("setVisible", { visible: !!visible }, () => {
        state.visible = !!visible;
      }),
    interactionMode: () => state.interactive,
    setInteractionMode: (on: unknown) =>
      presentationOp("setInteractionMode", { on: !!on }, () => {
        setInteraction(!!on);
      }),
    onInteractionMode: (listener: (on: boolean) => void) => {
      modeListeners.push(listener);
      return () => {
        const at = modeListeners.indexOf(listener);
        if (at >= 0) modeListeners.splice(at, 1);
      };
    },
    appMode: () => state.mode,
    setAppMode: async (mode: unknown) => {
      if (mode !== "expanded" && mode !== "minified")
        refuse(
          "presentation",
          { op: "setAppMode", mode: String(mode) },
          "mode",
        );
      return presentationOp("setAppMode", { mode: String(mode) }, () => {
        state.mode = String(mode);
      });
    },
    setHotkeysEnabled: (enabled: unknown) =>
      presentationOp("setHotkeysEnabled", { enabled: !!enabled }),
    // HostBridge.swift: op("setFullScreen", { on }).
    setFullScreen: (on: unknown) =>
      presentationOp("setFullScreen", { on: !!on }),
    // See-through: the rectangles the window takes the mouse in (null: all of it).
    // HitRegions.decode: null, or at most 64 rectangles of exactly
    // {x, y, width, height}, finite, width and height in (0, 20000], |x|, |y|
    // at most 20000.
    setHitRegions: async (raw: unknown) => {
      const regions = raw === undefined ? null : raw;
      const bad = (reason: string) =>
        refuse("presentation", { op: "setHitRegions", regions }, reason);
      if (regions !== null) {
        if (!Array.isArray(regions) || regions.length > 64) bad("regions");
        for (const item of regions as unknown[]) {
          const rect = item as Json;
          const exact =
            typeof item === "object" &&
            item !== null &&
            !Array.isArray(item) &&
            Object.keys(rect).sort().join(",") === "height,width,x,y";
          if (
            !exact ||
            !isNumber(rect["x"]) ||
            !isNumber(rect["y"]) ||
            !isNumber(rect["width"]) ||
            !isNumber(rect["height"]) ||
            Math.abs(rect["x"]) > 20000 ||
            Math.abs(rect["y"]) > 20000 ||
            rect["width"] <= 0 ||
            rect["width"] > 20000 ||
            rect["height"] <= 0 ||
            rect["height"] > 20000
          )
            bad("rect");
        }
      }
      return presentationOp("setHitRegions", { regions }, () => {
        state.hitRegions = regions as unknown[] | null;
      });
    },
    // The decoder: width 200..4000, height (optional) 60..4000, both finite.
    setWindowSize: async (size: { width: number; height?: number }) => {
      const params: Json = {
        width: Number(size?.width),
        ...(size?.height !== undefined ? { height: Number(size.height) } : {}),
      };
      const width = params["width"];
      const height = params["height"];
      if (!isNumber(width) || width < 200 || width > 4000)
        refuse("presentation", { op: "setWindowSize", ...params }, "width");
      if (
        height !== undefined &&
        (!isNumber(height) || height < 60 || height > 4000)
      )
        refuse("presentation", { op: "setWindowSize", ...params }, "height");
      return presentationOp("setWindowSize", params, () => {
        state.windowSize = params as { width: number; height?: number };
      });
    },
  });

  const setInteraction = (on: boolean) => {
    const before = state.interactive;
    state.interactive = on;
    if (before !== on) for (const listener of [...modeListeners]) listener(on);
  };

  const screenWatch = Object.freeze({
    start: async (request: Json) => {
      record("screenWatchStart", { ...request });
      state.watching = true;
      return { ok: true };
    },
    stop: async () => {
      record("screenWatchStop");
      state.watching = false;
    },
    status: () => ({ watching: state.watching }),
    onChange: (
      listener: (event: {
        at: number;
        bits: number;
        display?: Display;
      }) => void,
    ) => {
      watchListeners.push(listener);
      return () => {
        const at = watchListeners.indexOf(listener);
        if (at >= 0) watchListeners.splice(at, 1);
      };
    },
    onStatus: () => () => undefined,
  });

  const engineReply = (listening: boolean, paused = false) => {
    if (engineRefusal) return { ok: false, reason: engineRefusal };
    engineCurrent = engineState(listening, paused);
    for (const listener of [...engineListeners]) listener(engineCurrent);
    return { ok: true, engine: engineCurrent };
  };
  const engine = Object.freeze({
    start: async (request: Json) => {
      record("engine.start", {
        sources: request["sources"],
        // A session id is an opaque identifier, not content.
        sessionId: request["sessionId"],
      });
      return engineReply(true);
    },
    stop: async () => {
      record("engine.stop");
      return engineReply(false);
    },
    pause: async () => {
      record("engine.pause");
      return engineReply(true, true);
    },
    resume: async () => {
      record("engine.resume");
      return engineReply(true, false);
    },
    status: async () => ({ ok: true, engine: engineCurrent }),
    onEvent: (listener: (state: unknown) => void) => {
      engineListeners.push(listener);
      return () => {
        const at = engineListeners.indexOf(listener);
        if (at >= 0) engineListeners.splice(at, 1);
      };
    },
  });

  // The shell's sign-in, sign-out and permissions (HostBridge.swift `account`):
  // the decoder takes exactly google or linkedin; the other calls take nothing.
  // A signIn opens "the browser" (the state goes to waiting, as the shell's
  // does); a spec ends the attempt with `setSignIn`. The shim never leaves the
  // page: Studio's redemption is the real server's, done by the spec's navigation.
  type AccountState = { phase: string; provider?: string };
  const accountState = {
    current: { phase: "idle" } as AccountState,
    refuseSignIn: false,
    permissions: { microphone: "granted", screen: "granted" } as Json,
  };
  const accountListeners: Array<(state: AccountState) => void> = [];
  const setAccountState = (next: AccountState) => {
    accountState.current = next;
    for (const listener of [...accountListeners]) listener({ ...next });
  };
  const account = Object.freeze({
    signIn: async (provider: unknown) => {
      if (provider !== "google" && provider !== "linkedin")
        refuse("signIn", { provider: String(provider) }, "provider");
      record("signIn", { provider });
      if (accountState.refuseSignIn || accountState.current.phase === "waiting")
        return false;
      setAccountState({ phase: "waiting", provider: String(provider) });
      return true;
    },
    cancelSignIn: async () => {
      record("cancelSignIn");
      setAccountState({ phase: "idle" });
    },
    reopenSignIn: async () => {
      record("reopenSignIn");
      return accountState.current.phase === "waiting";
    },
    copySignInLink: async () => {
      record("copySignInLink");
      return accountState.current.phase === "waiting";
    },
    signOut: async () => {
      record("signOut");
      return true;
    },
    state: () => ({ ...accountState.current }),
    onState: (listener: (state: AccountState) => void) => {
      accountListeners.push(listener);
      return () => {
        const at = accountListeners.indexOf(listener);
        if (at >= 0) accountListeners.splice(at, 1);
      };
    },
    // Polled by the idle screen: not recorded, so it never floods the log.
    permissions: async () => ({ ...accountState.permissions }),
  });

  const host = {
    version: 1,
    hostKind: "native-macos",
    capabilities: Object.freeze([...options.capabilities]),
    // The decoder: keys within mode/region/displayId/intent; a known mode; a
    // region (finite, inside the unit square) exactly when the mode is
    // "region"; a displayId only with a region; intent absent, explicit or auto.
    captureScreen: async (request: Json) => {
      const asked = { ...(request ?? {}) } as Json;
      const bad = (reason: string) => refuse("captureScreen", asked, reason);
      if (!keysWithin(asked, ["mode", "region", "displayId", "intent"]))
        bad("keys");
      if (
        asked["intent"] !== undefined &&
        asked["intent"] !== "explicit" &&
        asked["intent"] !== "auto"
      )
        bad("intent");
      const mode = asked["mode"];
      if (mode !== "focused-window" && mode !== "region" && mode !== "display")
        bad("mode");
      const displayId = asked["displayId"];
      if (displayId !== undefined && displayId !== null) {
        if (mode !== "region" || !isUint32(displayId)) bad("displayId");
      }
      const region = asked["region"];
      if (mode !== "region") {
        if (region !== undefined && region !== null) bad("region");
      } else {
        const box = region as Json | undefined;
        if (
          typeof region !== "object" ||
          region === null ||
          !isNumber(box?.["x"]) ||
          !isNumber(box?.["y"]) ||
          !isNumber(box?.["width"]) ||
          !isNumber(box?.["height"]) ||
          (box["x"] as number) < 0 ||
          (box["y"] as number) < 0 ||
          (box["width"] as number) <= 0 ||
          (box["height"] as number) <= 0 ||
          (box["x"] as number) + (box["width"] as number) > 1 ||
          (box["y"] as number) + (box["height"] as number) > 1
        )
          bad("region");
      }
      record("captureScreen", asked);
      state.captureCount += 1;
      if (state.captureResult) return state.captureResult;
      const base64 = jpeg(`capture ${state.captureCount}`);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      state.captured.push({
        n: state.captureCount,
        display: currentDisplay()?.name ?? "",
        digest: Array.from(hash.slice(0, 4), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      });
      return {
        ok: true,
        mediaType: "image/jpeg",
        base64,
        displayId: currentDisplay()?.id ?? 1,
        ...(currentDisplay() ? { display: currentDisplay() } : {}),
        pinned: state.pinnedDisplay !== null,
        ...(state.captureOcr ? { ocr: state.captureOcr } : {}),
      };
    },
    listDisplays: async (request?: { thumbnails?: boolean }) => {
      record("listDisplays", request ?? {});
      const fallback = state.pinFallbackPending;
      state.pinFallbackPending = false;
      return {
        ok: true,
        displays: state.displays.map((display) =>
          request?.thumbnails === false
            ? { display }
            : {
                display,
                thumbnail: {
                  mediaType: "image/jpeg",
                  base64: jpeg(display.name),
                },
              },
        ),
        pinnedDisplayId: state.pinnedDisplay,
        ...(fallback ? { pinFallback: "display-unavailable" } : {}),
      };
    },
    setCaptureDisplay: async (displayId: unknown) => {
      if (displayId !== null && !isUint32(displayId))
        refuse("setCaptureDisplay", { displayId }, "displayId");
      record("setCaptureDisplay", { displayId });
      if (displayId === null) {
        state.pinnedDisplay = null;
        return { ok: true, pinned: false };
      }
      const display = state.displays.find((d) => d.id === displayId);
      if (!display) return { ok: false, reason: "display-unavailable" };
      state.pinnedDisplay = display.id;
      return { ok: true, pinned: true, display };
    },
    pinOnTop: async (pinned: unknown) => {
      record("pinOnTop", { pinned: !!pinned });
      state.pinned = !!pinned;
      return state.pinned;
    },
    // externalURL: at most 2048 characters, http(s) with a host and no user
    // info; or exactly the one Screen Recording settings address.
    openExternal: async (url: unknown) => {
      const text = String(url);
      let allowed =
        text === SCREEN_RECORDING_SETTINGS || text === MICROPHONE_SETTINGS;
      if (!allowed && text.length <= 2048) {
        try {
          const parsed = new URL(text);
          allowed =
            (parsed.protocol === "https:" || parsed.protocol === "http:") &&
            parsed.hostname !== "" &&
            parsed.username === "" &&
            parsed.password === "";
        } catch {}
      }
      if (!allowed) refuse("openExternal", { url: text }, "url");
      record("openExternal", { url: text });
    },
    // The shell's Vision reading, as a stub: no text found, with the metrics a
    // blank frame has. A spec sets the answer with `setRecognizeText`. What
    // Vision really reads is not provable here. Only the image's type and size
    // are recorded, never its bytes.
    recognizeText: async (image: { mediaType?: unknown; base64?: unknown }) => {
      const mediaType = String(image?.mediaType);
      const base64 = typeof image?.base64 === "string" ? image.base64 : "";
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(mediaType) ||
        base64 === ""
      )
        refuse(
          "recognizeText",
          { mediaType, base64Length: base64.length },
          "image",
        );
      record("recognizeText", { mediaType, base64Length: base64.length });
      if (!options.textRecognition) return { ok: false, reason: "unavailable" };
      return (
        state.recognizeResult ?? {
          ok: true,
          engine: "vision",
          text: "",
          confidence: 0,
          truncated: false,
          metrics: { coverage: 0, meanConfidence: 0, largestGap: 1, boxes: 0 },
        }
      );
    },
    ...(options.engine ? { engine } : {}),
    account,
    ...(options.consent !== undefined
      ? {
          consent: Object.freeze({
            granted: () => options.consent === true,
            open: async () => {
              record("consent.open");
            },
          }),
        }
      : {}),
    presentation,
    screenWatch,
    onHotkey: (listener: (name: string) => void) => {
      hotkeyListeners.push(listener);
      return () => {
        const at = hotkeyListeners.indexOf(listener);
        if (at >= 0) hotkeyListeners.splice(at, 1);
      };
    },
  };
  Object.defineProperty(window, "studioHost", {
    value: Object.freeze(host),
    configurable: false,
  });

  // The test-side control surface (not part of the bridge contract).
  Object.defineProperty(window, "__e2eHost", {
    value: {
      calls: () => calls.map((call) => ({ ...call })),
      clear: () => {
        calls.length = 0;
      },
      fireIntent: (name: string) => {
        for (const listener of [...hotkeyListeners]) listener(name);
      },
      setInteraction,
      fireScreenChange: (bits = 12) => {
        const display = currentDisplay();
        for (const listener of [...watchListeners])
          listener({ at: Date.now(), bits, ...(display ? { display } : {}) });
      },
      // The displays the picker lists (and captures may come from).
      setDisplays: (displays: Display[]) => {
        state.displays = displays;
        if (
          state.pinnedDisplay !== null &&
          !displays.some((d) => d.id === state.pinnedDisplay)
        ) {
          state.pinnedDisplay = null;
          state.pinFallbackPending = true;
        }
      },
      setCapture: (result: unknown) => {
        state.captureResult = result;
      },
      setCaptureOcr: (ocr: unknown) => {
        state.captureOcr = ocr;
      },
      setRecognizeText: (result: unknown) => {
        state.recognizeResult = result;
      },
      rejected: () => rejected.map((entry) => ({ ...entry })),
      refuse: (op: string, on = true) => {
        if (on) refused.add(op);
        else refused.delete(op);
      },
      setEngineRefusal: (reason: string | null) => {
        engineRefusal = reason;
      },
      emitEngine: (next: unknown) => {
        engineCurrent = next as typeof engineCurrent;
        for (const listener of [...engineListeners]) listener(next);
      },
      setFramePattern: (pattern: boolean[] | null) => {
        state.framePattern = pattern;
      },
      captures: () => state.captured.map((entry) => ({ ...entry })),
      setSignIn: (next: unknown) => setAccountState(next as AccountState),
      setSignInRefusal: (refuseIt: boolean) => {
        accountState.refuseSignIn = refuseIt;
      },
      setPermissions: (next: unknown) => {
        accountState.permissions = next as Json;
      },
      state: () => ({ ...state }),
    },
    configurable: false,
  });
}

const DEFAULT_CAPABILITIES = [
  "capture-screen",
  "pin-on-top",
  "hotkeys",
  "open-external",
  "screen-watch",
  "display-selection",
  "account",
];

const DEFAULTS: InstalledOptions = {
  capabilities: [...DEFAULT_CAPABILITIES, "text-recognition"],
  textRecognition: true,
  presentationCapabilities: ["always-on-top", "all-spaces", "hit-regions"],
  engine: true,
  nativeToasts: true,
};

// A handle on one page's shim.
export class HostShim {
  constructor(private readonly page: Page) {}

  // Every bridge call so far, optionally only a method or presentation op
  // (`calls("setWindowSize")`, `calls("captureScreen")`).
  async calls(name?: string): Promise<HostCall[]> {
    const all = await this.page.evaluate(() =>
      (
        window as unknown as { __e2eHost: { calls(): HostCall[] } }
      ).__e2eHost.calls(),
    );
    return name ? all.filter((c) => c.op === name || c.method === name) : all;
  }

  clear(): Promise<void> {
    return this.page.evaluate(() =>
      (window as unknown as { __e2eHost: { clear(): void } }).__e2eHost.clear(),
    );
  }

  // The shell's hotkey/menu intent reaching the page (`chat.focus`,
  // `capture.analyze`, `transcribe.toggle`, `skill.next`, `auto.toggle`, ...).
  fireIntent(name: string): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as { __e2eHost: { fireIntent(n: string): void } }
        ).__e2eHost.fireIntent(value),
      name,
    );
  }

  // The shell reporting an interaction-mode change (what Cmd+Shift+I does).
  setInteraction(on: boolean): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as {
            __e2eHost: { setInteraction(o: boolean): void };
          }
        ).__e2eHost.setInteraction(value),
      on,
    );
  }

  fireScreenChange(bits = 12): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as {
            __e2eHost: { fireScreenChange(b: number): void };
          }
        ).__e2eHost.fireScreenChange(value),
      bits,
    );
  }

  // The displays the shell reports (ids, names, 1-based index, count); a pinned
  // display that is no longer listed falls back to following the browser.
  setDisplays(
    displays: Array<{ id: number; name: string; index: number; count: number }>,
  ): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as { __e2eHost: { setDisplays(d: unknown): void } }
        ).__e2eHost.setDisplays(value),
      displays,
    );
  }

  // Makes the next captures fail like the shell would (`permission-denied`...), or
  // carry an exact result, including a `display` object ({id, name, index, count}),
  // `pinned` and `pinFallback`.
  setCapture(result: unknown): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as { __e2eHost: { setCapture(r: unknown): void } }
        ).__e2eHost.setCapture(value),
      result,
    );
  }

  // The engine's next start answers with this refusal (an EngineStartRefusal:
  // "store-failed", "gone", ...), or null to accept again.
  setEngineRefusal(reason: string | null): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as {
            __e2eHost: { setEngineRefusal(r: string | null): void };
          }
        ).__e2eHost.setEngineRefusal(value),
      reason,
    );
  }

  // The `ocr` block the default capture carries (D35): Apple Vision's text and,
  // optionally, its `metrics` ({coverage, meanConfidence, largestGap, boxes}).
  // null: captures carry no text, like a shell without Vision.
  setCaptureOcr(ocr: unknown): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as {
            __e2eHost: { setCaptureOcr(o: unknown): void };
          }
        ).__e2eHost.setCaptureOcr(value),
      ocr,
    );
  }

  // What the shim's `recognizeText` answers (a StudioHostTextRecognitionResult);
  // null: no text, like a blank frame.
  setRecognizeText(result: unknown): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as {
            __e2eHost: { setRecognizeText(r: unknown): void };
          }
        ).__e2eHost.setRecognizeText(value),
      result,
    );
  }

  // The shell's sign-in state, as it pushes it to the page: waiting for a
  // provider's browser, idle (cancelled, or finished), or timed out.
  setSignIn(
    state:
      | { phase: "idle" }
      | { phase: "waiting"; provider: "google" | "linkedin" }
      | { phase: "timed-out" },
  ): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as { __e2eHost: { setSignIn(s: unknown): void } }
        ).__e2eHost.setSignIn(value),
      state,
    );
  }

  // true: the shell cannot open the browser (signIn answers false).
  setSignInRefusal(refuses: boolean): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as {
            __e2eHost: { setSignInRefusal(r: boolean): void };
          }
        ).__e2eHost.setSignInRefusal(value),
      refuses,
    );
  }

  // What macOS says about each permission ("granted" | "denied" | "undetermined").
  setPermissions(permissions: {
    microphone: "granted" | "denied" | "undetermined";
    screen: "granted" | "denied" | "undetermined";
  }): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as {
            __e2eHost: { setPermissions(p: unknown): void };
          }
        ).__e2eHost.setPermissions(value),
      permissions,
    );
  }

  // Calls the Swift decoder would have refused (the page's promise rejected).
  // A healthy page sends none: the fixtures assert this at the end of a test.
  async rejected(): Promise<
    Array<{ method: string; params: Record<string, unknown>; reason: string }>
  > {
    return this.page.evaluate(
      () =>
        (
          window as unknown as { __e2eHost?: { rejected(): never[] } }
        ).__e2eHost?.rejected() ?? [],
    );
  }

  // The shell refusing one presentation operation (it returns false).
  refuse(op: string, on = true): Promise<void> {
    return this.page.evaluate(
      ([name, flag]) =>
        (
          window as unknown as {
            __e2eHost: { refuse(o: string, f: boolean): void };
          }
        ).__e2eHost.refuse(name as string, flag as boolean),
      [op, on],
    );
  }

  // Makes the default capture a frame whose difference hash is known: eight
  // row flags, true = that row brightens left to right (see the shim's state).
  // Two patterns that differ in k rows differ by 8k bits of the page's hash.
  setFramePattern(pattern: boolean[] | null): Promise<void> {
    return this.page.evaluate(
      (value) =>
        (
          window as unknown as {
            __e2eHost: { setFramePattern(p: boolean[] | null): void };
          }
        ).__e2eHost.setFramePattern(value),
      pattern,
    );
  }

  // Every default capture so far, in order, with the digest of its bytes.
  captures(): Promise<Array<{ n: number; display: string; digest: string }>> {
    return this.page.evaluate(() =>
      (
        window as unknown as {
          __e2eHost: {
            captures(): Array<{ n: number; display: string; digest: string }>;
          };
        }
      ).__e2eHost.captures(),
    );
  }

  state(): Promise<{
    interactive: boolean;
    mode: string;
    visible: boolean;
    settingsOpen: boolean;
    windowSize: { width: number; height?: number } | null;
    pinned: boolean;
    watching: boolean;
    pinnedDisplay: number | null;
  }> {
    return this.page.evaluate(() =>
      (
        window as unknown as { __e2eHost: { state(): never } }
      ).__e2eHost.state(),
    );
  }
}

// Installs the bridge before any page script runs, in every page of the
// context (the panel and the Settings window are separate pages, as in the
// shell). Returns a function that makes a handle for a page.
export async function installHostShim(
  context: BrowserContext,
  options: ShimOptions = {},
): Promise<(page: Page) => HostShim> {
  // Serialised as source so a TypeScript runner's helper (esbuild's `__name`)
  // cannot leak into the page.
  const merged: InstalledOptions = { ...DEFAULTS, ...options };
  // `textRecognition: false` is a shell without Vision: not advertised.
  if (options.textRecognition === false && !options.capabilities)
    merged.capabilities = [...DEFAULT_CAPABILITIES];
  const source = `var __name=function(f){return f};(${installShim.toString()})(${JSON.stringify(merged)});`;
  await context.addInitScript({ content: source });
  return (page) => new HostShim(page);
}

// The overlay URL exactly as the shell builds it (StudioLocation.overlayURL):
// /t/:tenant/p/interview/live/overlay?host=native[&panel=single|settings]
// [&handsfree=1][&session=<id>].
export function nativeOverlayUrl(
  webUrl: string,
  tenantSlug: string,
  options: {
    panel?: "single" | "settings";
    handsFree?: boolean;
    sessionId?: string;
  } = {},
): string {
  const query = new URLSearchParams({ host: "native" });
  if (options.panel) query.set("panel", options.panel);
  if (options.handsFree) query.set("handsfree", "1");
  if (options.sessionId) query.set("session", options.sessionId);
  return `${webUrl}/t/${tenantSlug}/p/interview/live/overlay?${query}`;
}

// The end-of-test check of the fixtures: no page of the context made a call the
// shell's decoder refuses. A page that is already gone is skipped.
export async function assertNoRejectedHostCalls(
  context: BrowserContext,
): Promise<void> {
  const found: string[] = [];
  for (const page of context.pages()) {
    try {
      for (const entry of await new HostShim(page).rejected())
        found.push(`${entry.method} (${entry.reason})`);
    } catch {}
  }
  if (found.length > 0)
    throw new Error(
      `the page made calls the native shell's decoder would refuse: ${found.join(", ")}`,
    );
}
