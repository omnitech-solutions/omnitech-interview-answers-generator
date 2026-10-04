// The browser's own screen capture for Analyze. The person picks a window, tab
// or screen once, in the browser's picker, from a click in this document; the
// stream then stays open and the preview stays on this device. A frame is taken
// only when Analyze is pressed: it is cropped to the person's region, scaled
// down and encoded here, so pixels outside the region never leave the device.
//
// [SAFETY] The label sent with a frame says only what KIND of source it is
// ("Window", "Tab", "Screen") and whether a region was applied. It is never the
// title of a window or tab.
import { maxOwnerCaptureBytes } from "@omnitech/interview-contracts";
import { cropPixels, fitSize, isFull, type Rect } from "./mask-geometry";

export const MAX_LONG_SIDE = 1920;
// Encoding qualities tried in order, then smaller sizes, to stay under the limit.
export const QUALITIES = [0.85, 0.7, 0.55, 0.4, 0.3] as const;
export const SHRINK_STEPS = 4;
export const SHRINK_FACTOR = 0.75;

export type SourceKind =
  | "Window"
  | "Tab"
  | "Screen"
  | "Shared source"
  | "This Mac";

export class ShareError extends Error {
  constructor(readonly code: "unsupported" | "cancelled" | "failed") {
    super(code);
  }
}
export class FrameError extends Error {
  constructor(
    readonly code:
      | "not-ready"
      | "too-large"
      | "encode-failed"
      | "display-changed",
  ) {
    super(code);
  }
}

// The things a frame grab needs from the document, replaceable in tests.
export type FrameDeps = {
  createCanvas(): HTMLCanvasElement;
};
const browserDeps: FrameDeps = {
  createCanvas: () => document.createElement("canvas"),
};

export type ShareHandle = {
  stream: MediaStream;
  kind: SourceKind;
  // The (hidden) element the frames are read from.
  video: HTMLVideoElement;
  stop(): void;
  // Calls back once when the share ends, from the browser's own Stop sharing
  // too. Returns the remover.
  onEnded(listener: () => void): () => void;
};

export const sourceKind = (surface: string | undefined): SourceKind =>
  surface === "monitor"
    ? "Screen"
    : surface === "window"
      ? "Window"
      : surface === "browser"
        ? "Tab"
        : "Shared source";

export const frameLabel = (kind: SourceKind, masked: boolean): string =>
  masked ? `${kind} · region` : kind;

// Must be called straight from a click handler in the document that will show
// the preview (the overlay's own page, or the PiP's iframe).
export async function startShare(): Promise<ShareHandle> {
  const media = navigator.mediaDevices;
  if (!media || typeof media.getDisplayMedia !== "function")
    throw new ShareError("unsupported");
  let stream: MediaStream;
  try {
    // Video only: this never takes audio.
    stream = await media.getDisplayMedia({ video: true, audio: false });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new ShareError(
      name === "NotAllowedError" || name === "AbortError"
        ? "cancelled"
        : "failed",
    );
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    for (const each of stream.getTracks()) each.stop();
    throw new ShareError("failed");
  }
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void Promise.resolve(video.play()).catch(() => undefined);
  const listeners = new Set<() => void>();
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    video.srcObject = null;
    for (const listener of [...listeners]) listener();
    listeners.clear();
  };
  track.addEventListener("ended", finish);
  return {
    stream,
    kind: sourceKind(track.getSettings().displaySurface),
    video,
    stop() {
      for (const each of stream.getTracks()) each.stop();
      finish();
    },
    onEnded(listener) {
      if (ended) {
        listener();
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Frame = {
  blob: Blob;
  label: string;
  width: number;
  height: number;
  masked: boolean;
};

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new FrameError("encode-failed")),
      "image/jpeg",
      quality,
    );
  });
}

// Takes the current frame, crops it to `mask`, scales it so the long side is at
// most MAX_LONG_SIDE and encodes it as JPEG under the server's size limit.
export async function grabFrame(
  handle: Pick<ShareHandle, "video" | "kind">,
  mask: Rect,
  deps: FrameDeps = browserDeps,
): Promise<Frame> {
  const { video } = handle;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new FrameError("not-ready");
  const masked = !isFull(mask);
  const { sx, sy, sw, sh } = cropPixels(mask, width, height);
  let target = fitSize(sw, sh, MAX_LONG_SIDE);
  for (let shrink = 0; shrink <= SHRINK_STEPS; shrink += 1) {
    const canvas = deps.createCanvas();
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new FrameError("encode-failed");
    context.drawImage(video, sx, sy, sw, sh, 0, 0, target.width, target.height);
    for (const quality of QUALITIES) {
      const blob = await encode(canvas, quality);
      if (blob.size <= maxOwnerCaptureBytes)
        return {
          blob,
          label: frameLabel(handle.kind, masked),
          width: target.width,
          height: target.height,
          masked,
        };
    }
    target = {
      width: Math.max(1, Math.round(target.width * SHRINK_FACTOR)),
      height: Math.max(1, Math.round(target.height * SHRINK_FACTOR)),
    };
  }
  throw new FrameError("too-large");
}
