// Test doubles for browser capture and dictation: a fake display stream and
// getDisplayMedia, a video with a size, a canvas that records what is drawn and
// encodes to a size set by quality, and a SpeechRecognition.
import { type Mock, vi } from "vitest";

// A window whose TITLE is secret: nothing the app sends may contain it.
export const SECRET_TITLE = "Quarterly Bonuses - Private Bank";

export function fakeStream(surface = "window"): {
  stream: MediaStream;
  track: { label: string; stop: Mock };
  endFromBrowser(): void;
} {
  const listeners = new Map<string, Set<() => void>>();
  const track = {
    kind: "video",
    label: SECRET_TITLE,
    stop: vi.fn(),
    getSettings: () => ({ displaySurface: surface, width: 1920, height: 1080 }),
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) =>
      listeners.get(type)?.delete(fn),
  };
  const stream = {
    id: "fake-stream",
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
  return {
    stream: stream as unknown as MediaStream,
    track,
    // The browser's own "Stop sharing".
    endFromBrowser() {
      for (const fn of [...(listeners.get("ended") ?? [])]) fn();
    },
  };
}

export function installDisplayMedia(
  behaviour: (() => Promise<MediaStream>) | undefined,
) {
  const getDisplayMedia = behaviour ? vi.fn(behaviour) : undefined;
  Object.defineProperty(navigator, "mediaDevices", {
    value: getDisplayMedia ? { getDisplayMedia } : {},
    configurable: true,
  });
  return getDisplayMedia;
}

// The video element has a size and can "play".
export function installVideoSize(width = 1920, height = 1080) {
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    get: () => width,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    get: () => height,
    configurable: true,
  });
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
}

export type Draw = {
  args: number[];
  canvasWidth: number;
  canvasHeight: number;
};

// A canvas that records drawImage and encodes to `sizeFor(quality, area)` bytes.
export function installFakeCanvas(
  sizeFor: (quality: number, pixels: number) => number = () => 1000,
) {
  const draws: Draw[] = [];
  const qualities: number[] = [];
  const getContext = vi.fn(function (this: HTMLCanvasElement) {
    return {
      drawImage: (_video: unknown, ...args: number[]) =>
        draws.push({
          args,
          canvasWidth: this.width,
          canvasHeight: this.height,
        }),
    };
  });
  const toBlob = vi.fn(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    _type?: string,
    quality?: number,
  ) {
    qualities.push(quality ?? 0);
    const bytes = sizeFor(quality ?? 0, this.width * this.height);
    callback(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: getContext,
    configurable: true,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    value: toBlob,
    configurable: true,
  });
  return { draws, qualities };
}

// ---- Dictation ----------------------------------------------------------------

export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static localCapable = true;
  continuous = false;
  interimResults = false;
  lang = "";
  declare processLocally?: boolean;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start: Mock = vi.fn();
  stop: Mock = vi.fn(() => this.onend?.());
  abort: Mock = vi.fn();
  constructor() {
    // A browser that cannot recognise on-device has no such property.
    if (FakeRecognition.localCapable) this.processLocally = false;
    FakeRecognition.instances.push(this);
  }
  // Deliver results: [{ text, final }].
  say(...phrases: { text: string; final: boolean }[]) {
    const results = phrases.map((phrase) => ({
      isFinal: phrase.final,
      0: { transcript: phrase.text },
    }));
    this.onresult?.({
      resultIndex: 0,
      results: Object.assign(results, { length: results.length }),
    });
  }
}

export function installRecognition(enabled = true) {
  FakeRecognition.instances = [];
  FakeRecognition.localCapable = true;
  const host = window as unknown as Record<string, unknown>;
  if (enabled) host["webkitSpeechRecognition"] = FakeRecognition;
  else {
    host["webkitSpeechRecognition"] = undefined;
    host["SpeechRecognition"] = undefined;
  }
}
