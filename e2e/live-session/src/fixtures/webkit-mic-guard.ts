// WebKit never reaches the real microphone. Headless does not stop macOS from
// raising its 'Allow microphone' dialog when a WebKit process touches the real
// device or speech service, and the WebKit project has no fake-device flag as
// Chromium has. So every WebKit context gets an init script, installed BEFORE
// the page's own and before the browser spies, that REPLACES getUserMedia,
// enumerateDevices and the speech recognisers with synthetic ones. The native
// function is never captured, so the real API is structurally unreachable; the
// spies (browser-spies.ts) wrap the replacement and keep counting calls.
// `assertMicrophoneGuarded` fails a test whose page lost the replacement.
import type { Browser } from "@playwright/test";

function installMicrophoneStubInPage(): void {
  type Guard = { installed: true; stubbed: { getUserMedia: number } };
  const w = window as unknown as Record<string, unknown>;
  const guard: Guard = { installed: true, stubbed: { getUserMedia: 0 } };
  Object.defineProperty(w, "__e2eMicGuard", { value: guard });

  // A silent stream from the page's own audio graph: no device is opened.
  const silentStream = (): MediaStream => {
    try {
      const Context =
        (w["AudioContext"] as typeof AudioContext | undefined) ??
        (w["webkitAudioContext"] as typeof AudioContext | undefined);
      if (Context) {
        const destination = new Context().createMediaStreamDestination();
        return destination.stream;
      }
    } catch {
      // fall through to an empty stream
    }
    return new MediaStream();
  };
  const devices = {
    getUserMedia: async (): Promise<MediaStream> => {
      guard.stubbed.getUserMedia += 1;
      return silentStream();
    },
    enumerateDevices: async (): Promise<unknown[]> => [
      {
        deviceId: "e2e-silent",
        groupId: "e2e",
        kind: "audioinput",
        label: "E2E silent microphone",
        toJSON: () => ({}),
      },
    ],
    // The display-capture spy wraps this when it exists; the stub has none.
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const real = navigator.mediaDevices as unknown as
    | Record<string, unknown>
    | undefined;
  if (real) {
    // Replace on the instance only the audio entry points; getDisplayMedia and
    // the rest stay as the engine provides them (they never raise this dialog).
    real["getUserMedia"] = devices.getUserMedia;
    real["enumerateDevices"] = devices.enumerateDevices;
  } else {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: devices,
    });
  }

  // A recogniser that never listens; browser-spies.ts replaces it with the
  // scripted one when a spec drives dictation.
  class SilentRecognition {
    continuous = false;
    interimResults = false;
    lang = "en-US";
    onresult: unknown = null;
    onerror: unknown = null;
    onend: (() => void) | null = null;
    start() {}
    stop() {
      queueMicrotask(() => this.onend?.());
    }
    abort() {
      this.stop();
    }
  }
  w["SpeechRecognition"] = SilentRecognition;
  w["webkitSpeechRecognition"] = SilentRecognition;
}

const source = `var __name=function(f){return f};(${installMicrophoneStubInPage.toString()})()`;

// Pages found without the replacement, collected as they load (a page may be
// closed before the test ends, so teardown cannot look at it then).
const unguarded: string[] = [];

const hasReplacement = () =>
  (window as unknown as { __e2eMicGuard?: { installed?: boolean } })
    .__e2eMicGuard?.installed === true;

// Wraps `browser.newContext` / `newPage` so EVERY context a spec opens (the
// plain `page`, `native`, `openPanel` and any `browser.newContext()` in a spec)
// carries the replacement first, before any other init script, so later wrappers
// (the spies) sit on top of it, and checks each page once it has loaded.
export function guardWebkitBrowser(browser: Browser): void {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    await context.addInitScript(source);
    context.on("page", (page) =>
      page.on("domcontentloaded", () => {
        if (page.url() === "about:blank") return;
        page
          .evaluate(hasReplacement)
          .then((ok) => {
            if (!ok) unguarded.push(page.url());
          })
          .catch(() => {}); // a closed or navigating page cannot have been reached
      }),
    );
    return context;
  };
  browser.newPage = async (...args) => {
    const context = await browser.newContext(...args);
    return context.newPage();
  };
}

// Fails the test when a page loaded without the replacement (an init script
// that ran too late, or a context made some other way).
export function assertMicrophoneGuarded(): void {
  const found = unguarded.splice(0);
  if (found.length > 0)
    throw new Error(
      `WebKit page without the microphone replacement (the real getUserMedia could be reached): ${found.join(", ")}`,
    );
}
