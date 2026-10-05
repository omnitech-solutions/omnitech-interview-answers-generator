// Stand-ins for the two things headless Chromium cannot give a run, installed
// in the page BEFORE its scripts, plus readers for what the page did with them:
//  - a spy around getDisplayMedia / getUserMedia that keeps the streams, so a
//    spec can read whether a track is really live or really ended, and can make
//    the picker refuse;
//  - a controllable SpeechRecognition (headless Chromium has no recogniser), so
//    a spec decides what was "heard" or which error the browser raises.
// The page's own code (dictation, screen share, Auto) is the real thing; only
// the browser API underneath is scripted.
import type { BrowserContext, Page } from "@playwright/test";

function installBrowserSpiesInPage(): void {
  type Track = { readyState: string };
  const w = window as unknown as Record<string, unknown> & {
    navigator: Navigator;
  };
  const shares: MediaStream[] = [];
  const mics: MediaStream[] = [];
  const devices = navigator.mediaDevices;
  w["__refuseShare"] = false;
  if (devices && typeof devices.getDisplayMedia === "function") {
    const originalDisplay = devices.getDisplayMedia.bind(devices);
    devices.getDisplayMedia = async (constraints) => {
      if (w["__refuseShare"] === true)
        throw new DOMException("Permission denied", "NotAllowedError");
      const stream = await originalDisplay(constraints);
      shares.push(stream);
      return stream;
    };
  }
  // How many times the page ASKED for the microphone or built a recogniser,
  // whatever the answer (the T31 'Allow prompt' specs assert zero).
  const asked = { getUserMedia: 0, speechConstructed: 0 };
  w["__e2eAsked"] = asked;
  if (devices && typeof devices.getUserMedia === "function") {
    const originalUser = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints) => {
      asked.getUserMedia += 1;
      const stream = await originalUser(constraints);
      mics.push(stream);
      return stream;
    };
  }
  const states = (list: MediaStream[]) =>
    list.map((stream) =>
      stream.getTracks().map((track: Track) => track.readyState),
    );
  w["__e2eStreams"] = {
    shares: () => states(shares),
    mics: () => states(mics),
    // The browser's own "Stop sharing" bar: the track ends without the page
    // having asked, and fires `ended`.
    endShare: () => {
      for (const stream of shares)
        for (const track of stream.getTracks()) {
          track.stop();
          track.dispatchEvent(new Event("ended"));
        }
    },
  };

  // A recogniser the spec drives. The page's own code (dictation.ts) is real.
  type Recognition = {
    running: boolean;
    onresult: ((event: unknown) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
  };
  const live: Recognition[] = [];
  const stats = { started: 0, stopped: 0 };
  class FakeRecognition implements Recognition {
    running = false;
    continuous = false;
    interimResults = false;
    lang = "en-US";
    onresult: Recognition["onresult"] = null;
    onerror: Recognition["onerror"] = null;
    onend: Recognition["onend"] = null;
    constructor() {
      asked.speechConstructed += 1;
    }
    start() {
      this.running = true;
      stats.started += 1;
      live.push(this);
    }
    stop() {
      if (!this.running) return;
      this.running = false;
      stats.stopped += 1;
      queueMicrotask(() => this.onend?.());
    }
    abort() {
      this.stop();
    }
  }
  w["SpeechRecognition"] = FakeRecognition;
  w["webkitSpeechRecognition"] = FakeRecognition;
  w["__e2eSpeech"] = {
    stats: () => ({
      ...stats,
      listening: live.filter((each) => each.running).length,
    }),
    say: (text: string) => {
      const result = Object.assign([{ transcript: text }], { isFinal: true });
      for (const each of live)
        if (each.running)
          each.onresult?.({
            resultIndex: 0,
            results: Object.assign([result], { length: 1 }),
          });
    },
    fail: (error: string) => {
      for (const each of live)
        if (each.running) {
          each.onerror?.({ error });
          each.running = false;
          each.onend?.();
        }
    },
  };
}

export type BrowserSpies = {
  // Requests the page made for the microphone (getUserMedia) and recognisers it
  // built (SpeechRecognition / webkitSpeechRecognition), granted or not.
  asked(): Promise<{ getUserMedia: number; speechConstructed: number }>;
  streams(): Promise<{ shares: string[][]; mics: string[][] }>;
  endShare(): Promise<void>;
  refuseShare(on: boolean): Promise<void>;
  speech: {
    stats(): Promise<{ started: number; stopped: number; listening: number }>;
    say(text: string): Promise<void>;
    fail(error: string): Promise<void>;
  };
};

type Hook = Record<string, (...args: never[]) => unknown>;
const hook = (page: Page, name: "__e2eStreams" | "__e2eSpeech") => ({
  call: <T>(method: string, ...args: unknown[]): Promise<T> =>
    page.evaluate(
      ([target, fn, values]) =>
        ((window as unknown as Record<string, Hook>)[target as string] as Hook)[
          fn as string
        ]?.(...(values as never[])) as never,
      [name, method, args] as const,
    ) as Promise<T>,
});

// The init-script source of the spies, for a fixture that takes sources
// (`openPanel({ init: [browserSpiesInit()] })`), and the readers for one page.
// Serialised like the host shim, so a TypeScript runner's `__name` cannot leak.
export const browserSpiesInit = (): string =>
  `var __name=function(f){return f};(${installBrowserSpiesInPage.toString()})()`;

export function spiesFor(page: Page): BrowserSpies {
  const streams = hook(page, "__e2eStreams");
  const speech = hook(page, "__e2eSpeech");
  return {
    asked: () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __e2eAsked: { getUserMedia: number; speechConstructed: number };
            }
          ).__e2eAsked,
      ),
    streams: async () => ({
      shares: await streams.call<string[][]>("shares"),
      mics: await streams.call<string[][]>("mics"),
    }),
    endShare: () => streams.call<void>("endShare"),
    refuseShare: (on) =>
      page.evaluate((value) => {
        (window as unknown as Record<string, unknown>)["__refuseShare"] = value;
      }, on),
    speech: {
      stats: () =>
        speech.call<{ started: number; stopped: number; listening: number }>(
          "stats",
        ),
      say: (text) => speech.call<void>("say", text),
      fail: (error) => speech.call<void>("fail", error),
    },
  };
}

// Installs the spies for every page of a context (or one page) and returns the
// readers for a given page.
export async function installBrowserSpies(
  target: Page | BrowserContext,
): Promise<(page: Page) => BrowserSpies> {
  await target.addInitScript(`(${installBrowserSpiesInPage.toString()})()`);
  return spiesFor;
}
