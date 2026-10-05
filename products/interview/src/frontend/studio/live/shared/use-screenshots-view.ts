// What the screenshots area draws, from ONE model for both surfaces: the task's
// stored screenshots (the S-F read route, images only through `imageUrl`) and the
// ones staged on the device (their own Blobs). Pure builders plus one hook.
import type {
  LiveProcessingPolicy,
  LiveScreenshotSend,
} from "@omnitech/interview-contracts";
import { useEffect, useMemo, useRef } from "react";
import { createSessionClient } from "../session-client";
import { sessionFetch } from "../session-registry";
import {
  latestSent,
  sentByRevisionLine,
  stagedWillBe,
} from "./screenshot-send";
import type { SentAs, StagedShot } from "./screenshot-tray";
import {
  screenshotDisplayLabel,
  type TaskScreenshotItem,
  useTaskScreenshots,
} from "./task-screenshots";
import type { ScreenshotTray } from "./use-screenshot-tray";
import type { ImageRecognition } from "./use-staged-recognition";

export type ShotView = {
  key: string;
  // "S3" for a stored one; "New 1" for a staged one (it has no S number yet).
  label: string;
  time: string;
  displayLabel: string | null;
  // The revisions the screenshot fed (stored only).
  revisions: readonly number[];
  // null: nothing to draw (purged, or a Blob URL not available).
  src: string | null;
  staged: boolean;
  // What is known about its text, in words.
  text: string;
  // D35: what the server recorded as sent (the newest revision's call); null
  // when it recorded none, and always null for a staged one.
  sentAs: SentAs | null;
  // The same record per revision, as one line, when more than one is recorded.
  sentLine: string | null;
  // Staged only: what will happen under the current setting, or "Decided when
  // sent" when that cannot be known yet. null for a stored one.
  willBe: string | null;
};

export const timeLabel = (iso: string | number): string => {
  const at = typeof iso === "number" ? iso : Date.parse(iso);
  return Number.isNaN(at)
    ? ""
    : new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
};

const ENGINE_NAME = { vision: "Apple Vision", tesseract: "Tesseract" } as const;

export function storedShotViews(
  items: readonly TaskScreenshotItem[],
): ShotView[] {
  return items.map((item) => ({
    key: `stored-${item.ordinal}`,
    label: item.label,
    time: timeLabel(item.capturedAt),
    displayLabel: screenshotDisplayLabel(item),
    revisions: item.revisions,
    src: item.imageUrl,
    staged: false,
    text:
      item.hasText && item.ocrEngine
        ? `Text read on the device (${ENGINE_NAME[item.ocrEngine]})`
        : "No text read",
    sentAs: latestSent(item.sentByRevision ?? []),
    sentLine:
      (item.sentByRevision?.length ?? 0) > 1
        ? sentByRevisionLine(item.sentByRevision ?? [])
        : null,
    willBe: null,
  }));
}

// A staged image's text state, as the tray says it.
export function recognitionText(state: ImageRecognition | undefined): string {
  if (!state || state.status === "pending") return "Reading text...";
  if (state.status === "unavailable")
    return "Text reading is not available here; the image is still sent";
  if (state.status === "failed")
    return "Text could not be read; the image is still sent";
  return state.block ? "Text read on the device" : "No text found";
}

// Whether the read of a staged image is finished and found text, or found none;
// "unknown" while pending, failed or unavailable.
function textKnown(
  state: ImageRecognition | undefined,
): "text" | "none" | "unknown" {
  if (state?.status !== "done") return "unknown";
  return state.block ? "text" : "none";
}

export function stagedShotViews(
  items: readonly StagedShot[],
  states: ReadonlyMap<string, ImageRecognition>,
  urlOf: (blob: Blob) => string | null,
  setting: LiveScreenshotSend | null = null,
): ShotView[] {
  return items.map((item, index) => ({
    key: item.id,
    label: `New ${index + 1}`,
    time: timeLabel(item.at),
    displayLabel: item.display
      ? screenshotDisplayLabel({ display: item.display })
      : null,
    revisions: [],
    src: urlOf(item.blob),
    staged: true,
    text: recognitionText(states.get(item.id)),
    sentAs: null,
    sentLine: null,
    willBe: stagedWillBe({
      setting,
      text: textKnown(states.get(item.id)),
    }),
  }));
}

// Object URLs for staged Blobs: made once per Blob, revoked when the Blob is
// unstaged and when the view unmounts.
export function useObjectUrls(
  blobs: readonly Blob[],
): (blob: Blob) => string | null {
  const cache = useRef(new Map<Blob, string>());
  const canMake =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  const urls = cache.current;
  if (canMake)
    for (const blob of blobs)
      if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
  useEffect(() => {
    const live = new Set(blobs);
    for (const [blob, url] of urls)
      if (!live.has(blob)) {
        URL.revokeObjectURL(url);
        urls.delete(blob);
      }
  }, [blobs, urls]);
  useEffect(
    () => () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
    [urls],
  );
  return (blob) => urls.get(blob) ?? null;
}

export type ScreenshotsView = {
  tray: ScreenshotTray;
  // The task the screenshots belong to ("T3"); null while there is none.
  taskLabel: string | null;
  stored: readonly ShotView[];
  staged: readonly ShotView[];
  loading: boolean;
  error: boolean;
  // The icon's badge and name: stored plus staged.
  count: number;
};

// The stream's action cursor: changes when an action is added OR changes
// state (a publish changes status, not the count), so the stored list and its
// sent-as labels are read again when a revision publishes.
export const actionsVersion = (
  actions: readonly { id: string; dispatchStatus: string; updatedAt: string }[],
): string =>
  actions.map((a) => `${a.id}:${a.dispatchStatus}:${a.updatedAt}`).join("|");

type ViewInput<T extends ScreenshotTray | null> = {
  // null: the surface cannot stage here, so there is no area at all.
  tray: T;
  tenant: string;
  sessionId: string | null;
  taskId: string | null;
  taskLabel: string | null;
  version: string | number;
  policy: LiveProcessingPolicy | null;
};

// One hook per surface's answer area. The stored list is read again whenever
// `version` (the stream's action cursor) moves; with no task or no tray nothing
// is read.
export function useScreenshotsView(
  input: ViewInput<ScreenshotTray>,
): ScreenshotsView;
export function useScreenshotsView(
  input: ViewInput<ScreenshotTray | null>,
): ScreenshotsView | null;
export function useScreenshotsView(
  input: ViewInput<ScreenshotTray | null>,
): ScreenshotsView | null {
  const { tray, tenant, sessionId, taskId, taskLabel, version, policy } = input;
  const client = useMemo(
    () => createSessionClient(tenant, sessionFetch()),
    [tenant],
  );
  const read = useTaskScreenshots({
    client,
    sessionId,
    taskId: tray ? taskId : null,
    version,
    processingPolicy: policy,
  });
  const stored = useMemo(() => storedShotViews(read.items), [read.items]);
  const items = tray?.items ?? NONE;
  const blobs = useMemo(() => items.map((item) => item.blob), [items]);
  const urlOf = useObjectUrls(blobs);
  if (!tray) return null;
  const staged = stagedShotViews(
    tray.items,
    tray.recognition.states,
    urlOf,
    tray.screenshotSend,
  );
  return {
    tray,
    taskLabel,
    stored,
    staged,
    loading: read.loading,
    error: read.error,
    count: stored.length + staged.length,
  };
}

const NONE: readonly StagedShot[] = [];
