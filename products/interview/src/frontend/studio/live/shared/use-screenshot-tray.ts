// The staging tray as a hook: the pure state machine (screenshot-tray.ts), the
// on-device text of each staged image (use-staged-recognition.ts) and Apply as
// ONE atomic `applyContext` call. Both surfaces call it once (the native panel
// session, the web hands-free controller) and draw the same model. Images stay
// in this hook's memory until Apply; nothing is uploaded before it.
import type {
  LiveCaptureDisplay,
  LiveScreenshotSend,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { captureSourceNow } from "../host-display";
import type { OwnerHints } from "../session-capture";
import type { SessionActions } from "../session-snapshot";
import { DEFAULT_SCREENSHOT_SEND } from "./screenshot-send";
import {
  canApply,
  EMPTY_TRAY,
  effectiveIntent,
  MAX_STAGED_IMAGES,
  OCR_WAIT_MS,
  type StagedShot,
  sendsLine,
  TRAY_FAILURE_TEXT,
  type TrayFailure,
  type TrayIntent,
  trayFailureOf,
  trayOpen,
  trayReducer,
} from "./screenshot-tray";
import { imageAttachment } from "./task-screenshots";
import type { TaskTarget } from "./task-target";
import type { TextRecognizer } from "./text-recognizer";
import {
  type StagedRecognition,
  useStagedRecognition,
  useTextRecognizer,
} from "./use-staged-recognition";

const SENDING_NOW = "Sending the screenshots now.";

// What the first send of an Apply carried, kept verbatim for a Retry.
type FrozenRequest = {
  requestId: string;
  target: TaskTarget | null;
  hints: OwnerHints;
  label: string | undefined;
  images: Blob[];
  ocr: StagedRecognition["ocr"];
  display: (LiveCaptureDisplay | null)[];
};

const labelOf = (items: readonly StagedShot[]): string | undefined =>
  items.length === 1
    ? items[0]?.label
    : items.length > 1
      ? `${items.length} screenshots`
      : undefined;

export type GrabbedFrame = {
  blob: Blob;
  label: string;
  display: LiveCaptureDisplay | null;
};

// The display the native host last captured from, as the stored screenshot
// would carry it; null for a browser share (no host display is known).
export function lastGrabDisplay(native: boolean): LiveCaptureDisplay | null {
  if (!native) return null;
  const display = captureSourceNow().display;
  return display
    ? { name: display.name, index: display.index, count: display.count }
    : null;
}

export type ScreenshotTray = ReturnType<typeof useScreenshotTray>;

export function useScreenshotTray(input: {
  actions: Pick<SessionActions, "applyContext">;
  sessionId: string | null;
  // The task on show at its current revision; null when there is none.
  target: TaskTarget | null;
  deviceOnly: boolean;
  // D35: the session's saved setting; absent reads as Always.
  screenshotSend?: LiveScreenshotSend | undefined;
  hints: OwnerHints;
  mode: "auto" | "manual";
  // Tests pass a fake; the page uses its own (native Vision, else WASM).
  recognizer?: TextRecognizer;
}) {
  const { actions, sessionId, target, deviceOnly, hints, mode } = input;
  const [state, dispatch] = useReducer(trayReducer, EMPTY_TRAY);
  const pageRecognizer = useTextRecognizer();
  const recognizer = input.recognizer ?? pageRecognizer;
  const staged = useMemo(
    () => state.items.map((item) => ({ id: item.id, blob: item.blob })),
    [state.items],
  );
  const recognition: StagedRecognition = useStagedRecognition(
    staged,
    recognizer,
  );

  // What a callback needs from the latest render.
  const latest = useRef({ state, recognition, target, hints, sessionId });
  latest.current = { state, recognition, target, hints, sessionId };
  const sequence = useRef(0);
  // The request id now in flight (null: none). A session change clears it so
  // the new session's Apply is never blocked by the old one's.
  const applying = useRef<string | null>(null);
  // The exact request a first send used, kept for Retry (same id, same body:
  // the server refuses a changed body for a known id). Dropped when the tray
  // is edited (the id is cleared) or the session changes.
  const frozen = useRef<FrozenRequest | null>(null);

  // Another session starts with an empty tray, even mid-Apply.
  const lastSession = useRef(sessionId);
  useEffect(() => {
    if (lastSession.current === sessionId) return;
    lastSession.current = sessionId;
    applying.current = null;
    frozen.current = null;
    dispatch({ type: "reset" });
  }, [sessionId]);

  // Apply waits for the text still being read, up to OCR_WAIT_MS.
  const waiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (!recognition.pending)
      for (const wake of waiters.current.splice(0)) wake();
  }, [recognition.pending]);
  const waitForText = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (!latest.current.recognition.pending) return resolve();
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, OCR_WAIT_MS);
        waiters.current.push(done);
      }),
    [],
  );

  // Screens that draw the tray register while mounted: a capture is staged only
  // where the person can see the tray, else it is sent as before.
  const surfaces = useRef(0);
  const attach = useCallback(() => {
    surfaces.current += 1;
    return () => {
      surfaces.current -= 1;
    };
  }, []);
  const hasSurface = useCallback(() => surfaces.current > 0, []);

  const hasTarget = target !== null;
  const intent = effectiveIntent(state, hasTarget);
  const full = state.items.length >= MAX_STAGED_IMAGES;
  const addDisabledReason = deviceOnly
    ? (imageAttachment("device-only") as { reason: string }).reason
    : state.applying
      ? SENDING_NOW
      : full
        ? TRAY_FAILURE_TEXT.image_count
        : null;

  // Why a frame was not staged (null: it would be). Callers show it instead of
  // pretending the screenshot was kept.
  const stageRefusal = useCallback((): string | null => {
    const { state: now } = latest.current;
    if (now.applying) return SENDING_NOW;
    return now.items.length >= MAX_STAGED_IMAGES
      ? TRAY_FAILURE_TEXT.image_count
      : null;
  }, []);

  const stage = useCallback((frame: GrabbedFrame, as?: TrayIntent): boolean => {
    const now = latest.current.state;
    const added = !now.applying && now.items.length < MAX_STAGED_IMAGES;
    sequence.current += 1;
    dispatch({
      type: "stage",
      shot: placeholder(frame, sequence.current),
      ...(as ? { intent: as } : {}),
    });
    return added;
  }, []);

  const apply = useCallback(async (): Promise<boolean> => {
    const now = latest.current;
    if (applying.current !== null) return false;
    if (
      !canApply({
        state: now.state,
        hasTarget: now.target !== null,
        deviceOnly,
      })
    )
      return false;
    const requestId = now.state.requestId ?? `apply-${crypto.randomUUID()}`;
    const origin = now.sessionId;
    // [SAFETY] A Retry resends the first send verbatim; a first Apply freezes
    // the person's choices NOW (task, hints, label), so nothing changed while
    // the text was being read can redirect or alter the request.
    const retry =
      frozen.current?.requestId === requestId ? frozen.current : null;
    const choice = {
      target:
        effectiveIntent(now.state, now.target !== null) === "add"
          ? now.target
          : null,
      hints: now.hints,
      label: labelOf(now.state.items),
    };
    applying.current = requestId;
    dispatch({ type: "apply", requestId });
    let settled = false;
    const settle = (result: { ok: boolean; failure?: TrayFailure }): void => {
      if (settled) return;
      settled = true;
      if (result.ok) dispatch({ type: "applied", requestId });
      else
        dispatch({
          type: "failed",
          failure: result.failure ?? "request",
          requestId,
        });
    };
    try {
      let request = retry;
      if (!request) {
        await waitForText();
        // [SAFETY] The session changed while the text was read: these images
        // belong to the old one and must never go to the new one.
        if (latest.current.sessionId !== origin) return false;
        const after = latest.current;
        const items = after.state.items;
        request = {
          requestId,
          ...choice,
          images: items.map((item) => item.blob),
          ocr: after.recognition.ocr,
          display: items.map((item) => item.display),
        };
        frozen.current = request;
      }
      const result = await actions.applyContext(request.target, {
        ...request.hints,
        requestId,
        images: request.images,
        ocr: request.ocr,
        display: request.display,
        label: request.label,
      });
      settle(
        result.ok
          ? { ok: true }
          : { ok: false, failure: trayFailureOf(result) },
      );
      return result.ok;
    } finally {
      // Always a terminal event, so the tray can never stay "applying".
      settle({ ok: false });
      if (applying.current === requestId) applying.current = null;
    }
  }, [actions, deviceOnly, waitForText]);

  return {
    state,
    mode,
    items: state.items,
    recognition,
    open: trayOpen(state, mode),
    intent,
    hasTarget,
    applying: state.applying,
    // Reading text before the request goes out.
    reading: state.applying && recognition.pending,
    failure: state.failure as TrayFailure | null,
    failureText: state.failure ? TRAY_FAILURE_TEXT[state.failure] : null,
    sends: sendsLine(state.items.length, deviceOnly, input.screenshotSend),
    screenshotSend: input.screenshotSend ?? DEFAULT_SCREENSHOT_SEND,
    deviceOnly,
    canAdd: addDisabledReason === null,
    addDisabledReason,
    canApply: canApply({ state, hasTarget, deviceOnly }),
    setOpen: useCallback(
      (open: boolean) => dispatch({ type: "open", open }),
      [],
    ),
    setIntent: useCallback(
      (next: TrayIntent) => dispatch({ type: "intent", intent: next }),
      [],
    ),
    stage,
    stageRefusal,
    attach,
    hasSurface,
    remove: useCallback((id: string) => dispatch({ type: "remove", id }), []),
    move: useCallback(
      (id: string, by: -1 | 1) => dispatch({ type: "move", id, by }),
      [],
    ),
    crop: useCallback(
      (id: string, blob: Blob) => dispatch({ type: "crop", id, blob }),
      [],
    ),
    discard: useCallback(() => dispatch({ type: "discard" }), []),
    apply,
  };
}

// Registers a screen that draws the tray for as long as it is mounted.
export function useTraySurface(tray: ScreenshotTray | null): void {
  useEffect(() => tray?.attach(), [tray?.attach]);
}

function placeholder(frame: GrabbedFrame, n: number): StagedShot {
  return {
    id: `staged-${n}`,
    blob: frame.blob,
    label: frame.label,
    display: frame.display,
    at: Date.now(),
  };
}
