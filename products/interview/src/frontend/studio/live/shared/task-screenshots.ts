// A task's screenshots for the answer page: what the S-F read route says the
// task's revisions rest on, as items a strip can draw, plus the small pure rules
// around it (the count label, why a revision exists, whether images may be
// added). The hook never fetches image bytes: `imageUrl` is the owner's own
// screenshot route, for an <img> source.
import {
  displayLabel,
  type LiveCaptureDisplay,
  type LiveProcessingPolicy,
  type LiveRevisionReason,
  type LiveScreenshotSent,
  type LiveTaskScreenshotsResponse,
} from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import type { SessionClient } from "../session-client";

type ScreenshotsClient = Pick<
  SessionClient,
  "listTaskScreenshots" | "screenshotUrl"
>;

export type TaskScreenshotItem = {
  ordinal: number;
  // "S3": the session's own number for the screenshot.
  label: string;
  capturedAt: string;
  // null once the image is purged or was never stored.
  artifactId: string | null;
  // The task revisions the screenshot fed, ascending.
  revisions: readonly number[];
  imageUrl: string | null;
  // The text was read on the device (the engine is shown, the text never).
  hasText: boolean;
  ocrEngine: "vision" | "tesseract" | null;
  // The display it was captured on (a label); null when not recorded.
  display: LiveCaptureDisplay | null;
  // D35: what the server recorded as sent, per revision whose call finished;
  // empty when it recorded none.
  sentByRevision?:
    | readonly { revision: number; sent: LiveScreenshotSent }[]
    | undefined;
};

// "Display 2 of 3", or the display's name when it is the only one; null when
// the screenshot has no recorded display. One wording, shared with the capture
// result (the host contract's `displayLabel`).
export const screenshotDisplayLabel = (item: {
  display: LiveCaptureDisplay | null;
}): string | null =>
  // The label never reads the hardware id; 0 only satisfies the host type.
  item.display ? displayLabel({ id: 0, ...item.display }) : null;

export function taskScreenshotItems(
  response: LiveTaskScreenshotsResponse,
  imageUrlOf: (artifactId: string) => string,
): TaskScreenshotItem[] {
  return response.screenshots.map((shot) => ({
    ordinal: shot.ordinal,
    label: `S${shot.ordinal}`,
    capturedAt: shot.capturedAt,
    artifactId: shot.artifactId,
    revisions: shot.revisions,
    imageUrl: shot.artifactId ? imageUrlOf(shot.artifactId) : null,
    hasText: shot.ocrEngine !== null,
    ocrEngine: shot.ocrEngine,
    display: shot.display ?? null,
    sentByRevision: shot.sentByRevision ?? [],
  }));
}

export const screenshotCountLabel = (
  items: readonly { ordinal: number }[],
): string =>
  items.length === 0
    ? "No screenshots"
    : items.length === 1
      ? "1 screenshot"
      : `${items.length} screenshots`;

// Why a revision exists, for the ones the owner's own input made.
export const REVISION_REASON_LABEL: Record<LiveRevisionReason, string> = {
  regenerate: "Regenerated",
  "added-screenshot": "Screenshot added",
};

// Whether images may be added: a device-only session never sends an image to an
// agent, so the control is disabled with this reason rather than refused later.
export function imageAttachment(
  policy: LiveProcessingPolicy | null,
): { allowed: true } | { allowed: false; reason: string } {
  return policy === "device-only"
    ? {
        allowed: false,
        reason:
          "Device-only mode never sends a screenshot to a model, so none can be added.",
      }
    : { allowed: true };
}

export type TaskScreenshotsState = {
  items: readonly TaskScreenshotItem[];
  loading: boolean;
  error: boolean;
  canAttachImages: boolean;
  // Why adding is unavailable; null when it is allowed.
  attachDisabledReason: string | null;
};

// Reads the list for one task and again whenever `version` changes (the session
// stream's action cursor: a new revision or a settled action moves it). A late
// answer for a task, session or version that has since changed is dropped, and
// the items of the previous task are never shown for the next.
export function useTaskScreenshots(input: {
  client: ScreenshotsClient;
  sessionId: string | null;
  taskId: string | null;
  version: string | number;
  processingPolicy: LiveProcessingPolicy | null;
}): TaskScreenshotsState {
  const { client, sessionId, taskId, version, processingPolicy } = input;
  const [loaded, setLoaded] = useState<{
    key: string;
    items: readonly TaskScreenshotItem[];
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = sessionId && taskId ? `${sessionId}/${taskId}` : null;

  // `version` is only the refetch trigger.
  useEffect(() => {
    if (!sessionId || !taskId || !key) return;
    let current = true;
    client
      .listTaskScreenshots(sessionId, taskId)
      .then((response) => {
        if (!current) return;
        setFailed(null);
        setLoaded({
          key,
          items: taskScreenshotItems(response, (artifactId) =>
            client.screenshotUrl(sessionId, artifactId),
          ),
        });
      })
      .catch(() => {
        if (current) setFailed(key);
      });
    return () => {
      current = false;
    };
  }, [client, sessionId, taskId, key, version]);

  const attach = imageAttachment(processingPolicy);
  const items = loaded && loaded.key === key ? loaded.items : [];
  return {
    items,
    loading: key !== null && failed !== key && loaded?.key !== key,
    error: key !== null && failed === key,
    canAttachImages: attach.allowed,
    attachDisabledReason: attach.allowed ? null : attach.reason,
  };
}
