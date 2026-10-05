// The capture strip: the shared source (a live local preview, its kind and a
// Region chip), Stop sharing, and "Capture & analyze". Analyze takes a FRESH
// frame now, cropped to the region in this browser, and sends it; with no source
// shared the button opens the source menu instead. The last analyzed capture is
// kept as history below. Only the person pressing it sends a screenshot.
import { useEffect, useId, useRef } from "react";
import { Icon } from "../../icon";
import { shareMenuCopy } from "../host-adapter";
import { shortcutsFor } from "../shared/shortcuts";
import type { SourceKind } from "./capture-source";
import { LocalPreview } from "./local-preview";
import { useMenuPlacement } from "./menu-placement";
import type { Capture } from "./overlay-model";
import type { CaptureProgress } from "./use-companion-capture";
import { closeOnEscape, useDismiss } from "./use-dismiss";

// A new task, or a revision of the task being looked at.
export type AnalyzeChoice = { kind: "new" } | { kind: "attach" };
// Where the pixels come from: a fresh frame of the shared source, or the capture
// the companion last sent.
// "companion": the capture the companion last sent. "focused" and "region": ask
// the native companion to capture now (its focused window, or a region of the
// main display).
export type AnalyzeVia = "share" | "companion" | "focused" | "region";

// The chord the page binds for Capture & analyze, from the one shortcut table.
const ANALYZE_CHORD =
  shortcutsFor("web").find((shortcut) => shortcut.intent === "capture.analyze")
    ?.chord ?? "";

export const DEVICE_ONLY_ANALYZE =
  "Device-only mode never sends a screenshot to an assistant.";
export const EXPIRED_NOTE =
  "The companion did not answer within 20 s. Is it running with the screen source selected?";

// One plain line, with the fix, for each closed reason a capture request can end
// with. A failed or refused request never falls back to an older image.
const REFUSAL_TEXT: Record<string, string> = {
  vision_device_only: DEVICE_ONLY_ANALYZE,
  companion_update_required:
    "This companion is too old to take capture requests. Update the companion, then try again.",
  source_changed:
    "The screen the region was drawn on has changed. Choose the region again.",
  capture_request_stale:
    "That capture request is out of date. Press Capture & analyze again.",
  limit_reached:
    "This session has reached its capture limit, so nothing more can be captured.",
};
const FAILURE_TEXT: Record<string, string> = {
  "no-focused-window":
    "The companion found no focused window to capture. Click the window you want, then try again.",
  "permission-denied":
    "The companion isn’t allowed to record the screen. Allow Screen Recording for it in System Settings, then try again.",
  "source-gone":
    "The window or screen the companion was capturing is gone. Pick a source in the companion, then try again.",
  "source-changed":
    "The companion’s screen source changed, so the capture was dropped. Try again.",
  "capture-failed": "The companion couldn’t take the capture. Try again.",
};
export const refusalText = (reason: string | null): string =>
  (reason ? REFUSAL_TEXT[reason] : undefined) ??
  `The companion’s capture was refused${reason ? ` (${reason})` : ""}.`;
export const failureText = (reason: string | null): string =>
  (reason ? FAILURE_TEXT[reason] : undefined) ??
  `The companion couldn’t capture${reason ? ` (${reason})` : ""}. Nothing was analysed.`;

// What the strip says while a request to the companion is followed, or how it
// ended. null: nothing to say.
export function progressText(progress: CaptureProgress | null): string | null {
  if (!progress) return null;
  switch (progress.phase) {
    case "asking":
      return progress.mode === "region"
        ? "Asking the companion to capture your region…"
        : progress.mode === "display"
          ? "Asking the companion to capture your display…"
          : "Asking the companion to capture your focused window…";
    case "captured":
      return "Captured, analyzing…";
    case "expired":
      return EXPIRED_NOTE;
    case "refused":
      return refusalText(progress.reason);
    case "failed":
      return failureText(progress.reason);
  }
}

export type CaptureStripProps = {
  share: {
    status: "idle" | "starting" | "sharing";
    kind: SourceKind | null;
    stream: MediaStream | null;
  };
  masked: boolean;
  // The newest analyzed capture, as history.
  last: Capture | null;
  // The companion's screen source is receiving and has a capture to use.
  companionReady: boolean;
  // That stored capture: an image already sent, shown by identity and age.
  stored: Capture | null;
  // The companion's screen source is receiving, so it can be asked to capture.
  // Otherwise `reason` is why not, from the source's own advice.
  companionCanCapture: boolean;
  companionReason: string;
  // A request to the companion being followed, or how it ended.
  progress: CaptureProgress | null;
  // The task Attach would revise (T<n> rev <m>), if any.
  attachTo: { label: string } | null;
  nextTaskLabel: string;
  deviceOnly: boolean;
  // What the button is doing right now: taking the frame, or sending it and
  // waiting for the analysis to start. null: nothing.
  phase: "capturing" | "analyzing" | null;
  // The frame that was just taken: shown briefly, with its size.
  flash: {
    url: string | null;
    width: number;
    height: number;
    bytes: number;
  } | null;
  unavailable: boolean;
  // Work is running for the session: the button stops it (session-wide
  // stop-work; the session stays live and the next analyze starts a NEW task)
  // instead of capturing. Stopping the share is the separate icon beside the
  // source name.
  stopWork?: { stopping: boolean; onStop(): void } | null;
  menuOpen: boolean;
  onMenuOpenChange(open: boolean): void;
  onShare(): void;
  onStop(): void;
  onEditMask(): void;
  onAnalyze(choice: AnalyzeChoice, via: AnalyzeVia): void;
};

// The area is set: only it is captured. Pressing it opens the editor.
function CroppedChip({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      className="ov-pill ov-pill-button"
      data-testid="region-chip"
      title="Only the area you chose is captured. Press to change it."
      onClick={onClick}
    >
      <Icon name="crop" />
      Cropped
    </button>
  );
}

export function CaptureStrip(props: CaptureStripProps) {
  const {
    share,
    masked,
    last,
    companionReady,
    stored,
    companionCanCapture,
    companionReason,
    progress,
    attachTo,
    nextTaskLabel,
    deviceOnly,
    phase,
    flash,
    unavailable,
    menuOpen,
    onMenuOpenChange,
  } = props;
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuPlacement(menu, menuOpen);
  const sharing = share.status === "sharing";
  const close = () => onMenuOpenChange(false);
  useDismiss(root, menuOpen, close);
  useEffect(() => {
    if (menuOpen)
      root.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
  }, [menuOpen]);

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      closeOnEscape(close)(event);
      button.current?.focus();
      return;
    }
    const items = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? []),
    ];
    const move =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (move === 0) return;
    event.preventDefault();
    const at = items.indexOf(event.target as HTMLElement);
    items[(at + move + items.length) % items.length]?.focus();
  }
  const choose = (choice: AnalyzeChoice, via: AnalyzeVia) => {
    close();
    props.onAnalyze(choice, via);
    button.current?.focus();
  };
  const asking = progress?.phase === "asking";
  const stopWork = props.stopWork ?? null;
  const busy = phase !== null;
  const disabled = unavailable || busy || deviceOnly || asking;
  const analyzeChord = ANALYZE_CHORD;
  const progressNote = progressText(progress);

  return (
    <div className="ov-capture" ref={root} data-testid="ov-capture">
      <div className="ov-capture-main">
        <div className="ov-thumb" aria-hidden={!sharing}>
          {sharing ? (
            <LocalPreview stream={share.stream} className="ov-thumb-video" />
          ) : (
            <>
              <span />
              <span />
              <span />
            </>
          )}
        </div>
        <div className="ov-capture-text">
          {sharing ? (
            <div className="ov-capture-id">
              <span data-testid="share-kind">{share.kind}</span>
              {masked && <CroppedChip onClick={props.onEditMask} />}
              <button
                type="button"
                className="ov-icon-button"
                aria-label="Stop sharing"
                title="Stop sharing this source"
                onClick={props.onStop}
              >
                <Icon name="stop_screen_share" />
              </button>
            </div>
          ) : (
            <div className="ov-capture-label" data-testid="share-none">
              {share.status === "starting"
                ? "Waiting for you to choose…"
                : "No source shared"}
              {masked && <CroppedChip onClick={props.onEditMask} />}
            </div>
          )}
          {progressNote && (
            <div
              className="ov-capture-note ov-capture-progress"
              role="status"
              data-testid="capture-progress"
              data-phase={progress?.phase}
            >
              {progressNote}
            </div>
          )}
          {deviceOnly && (
            <div className="ov-capture-note" data-testid="analyze-note">
              {DEVICE_ONLY_ANALYZE}
            </div>
          )}
        </div>
        {stopWork ? (
          <button
            ref={button}
            type="button"
            className="ov-analyze stop"
            data-testid="stop-analysis"
            aria-busy={stopWork.stopping}
            disabled={stopWork.stopping}
            title="Stop the work that is running. The session stays live; the next analyze starts a new task."
            onClick={stopWork.onStop}
          >
            <Icon name="stop_circle" />
            {stopWork.stopping ? "Stopping…" : "Stop analysis"}
          </button>
        ) : (
          <button
            ref={button}
            type="button"
            className="ov-analyze"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            aria-busy={busy || asking}
            disabled={disabled}
            title={
              deviceOnly
                ? DEVICE_ONLY_ANALYZE
                : `Capture a fresh frame now and analyze it (${analyzeChord})`
            }
            onClick={() => onMenuOpenChange(!menuOpen)}
          >
            <Icon name="center_focus_strong" />
            {phase === "capturing"
              ? "Capturing…"
              : phase === "analyzing"
                ? "Analyzing…"
                : "Capture & analyze"}
            {!busy && <kbd className="ov-kbd">{analyzeChord}</kbd>}
          </button>
        )}
      </div>
      {flash && (
        <div className="ov-flash" role="status" data-testid="capture-flash">
          {flash.url && <img src={flash.url} alt="" />}
          <span>
            Captured · {flash.width} × {flash.height} ·{" "}
            {Math.max(1, Math.round(flash.bytes / 1024))} KB
          </span>
        </div>
      )}
      {last && (
        <div className="ov-capture-last" data-testid="capture-last">
          <span className="ov-muted">Last analyzed</span>{" "}
          <span className="ov-mono" data-testid="capture-id">
            {last.id}
          </span>
          <span className="ov-muted"> · {last.ageText} · </span>
          <span data-testid="capture-source">{last.sourceLabel}</span>
        </div>
      )}
      {menuOpen && (
        // The menu closes on Escape and moves with the arrow keys.
        <div
          id={menuId}
          ref={menu}
          role="menu"
          aria-label={sharing ? "Capture & analyze" : "Capture source"}
          className="ov-menu ov-analyze-menu"
          onKeyDown={onKeyDown}
        >
          {sharing ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="ov-menu-item"
                onClick={() => choose({ kind: "new" }, "share")}
              >
                <Icon name="add" />
                <span className="ov-menu-text">
                  <span className="ov-menu-label">
                    New task from a fresh capture
                  </span>
                  <span className="ov-menu-sub">
                    Captures now and starts {nextTaskLabel}
                  </span>
                </span>
              </button>
              {attachTo && (
                <button
                  type="button"
                  role="menuitem"
                  className="ov-menu-item"
                  onClick={() => choose({ kind: "attach" }, "share")}
                >
                  <Icon name="link" />
                  <span className="ov-menu-text">
                    <span className="ov-menu-label">
                      Attach a fresh capture to {attachTo.label}
                    </span>
                    <span className="ov-menu-sub">
                      Captures now and revises it
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="ov-menu-item"
                onClick={() => {
                  close();
                  props.onEditMask();
                }}
              >
                <Icon name="crop" />
                <span className="ov-menu-text">
                  <span className="ov-menu-label">Choose area…</span>
                  <span className="ov-menu-sub">
                    {masked
                      ? "Only the area you chose is captured"
                      : "Capture just part of the screen"}
                  </span>
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className="ov-menu-item"
                onClick={() => {
                  close();
                  props.onShare();
                }}
              >
                <Icon name="screen_share" />
                <span className="ov-menu-text">
                  <span className="ov-menu-label">{shareMenuCopy().label}</span>
                  <span className="ov-menu-sub">{shareMenuCopy().sub}</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="ov-menu-item"
                disabled={!companionReady || !stored}
                onClick={() => choose({ kind: "new" }, "companion")}
              >
                <Icon name="desktop_windows" />
                <span className="ov-menu-text">
                  <span className="ov-menu-label">Analyze stored capture</span>
                  <span className="ov-menu-sub">
                    {companionReady && stored
                      ? `Not a new capture: ${stored.id} · ${stored.sourceLabel}${stored.ageText ? ` · ${stored.ageText}` : ""}. Starts ${nextTaskLabel}`
                      : "No stored capture, or the companion’s screen source isn’t receiving"}
                  </span>
                </span>
              </button>
              {companionReady && attachTo && (
                <button
                  type="button"
                  role="menuitem"
                  className="ov-menu-item"
                  onClick={() => choose({ kind: "attach" }, "companion")}
                >
                  <Icon name="link" />
                  <span className="ov-menu-text">
                    <span className="ov-menu-label">
                      Attach stored capture{stored ? ` ${stored.id}` : ""} to{" "}
                      {attachTo.label}
                    </span>
                    <span className="ov-menu-sub">Revises that task</span>
                  </span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="ov-menu-item"
                disabled={!companionCanCapture}
                onClick={() => choose({ kind: "new" }, "focused")}
              >
                <Icon name="visibility" />
                <span className="ov-menu-text">
                  <span className="ov-menu-label">Follow focused window</span>
                  <span className="ov-menu-sub" data-testid="focus-note">
                    {companionCanCapture
                      ? `Asks the companion for the window you are in; starts ${nextTaskLabel}`
                      : companionReason}
                  </span>
                </span>
              </button>
              {companionCanCapture && attachTo && (
                <button
                  type="button"
                  role="menuitem"
                  className="ov-menu-item"
                  onClick={() => choose({ kind: "attach" }, "focused")}
                >
                  <Icon name="link" />
                  <span className="ov-menu-text">
                    <span className="ov-menu-label">
                      Attach the focused window to {attachTo.label}
                    </span>
                    <span className="ov-menu-sub">Revises that task</span>
                  </span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="ov-menu-item"
                disabled={!companionCanCapture}
                onClick={() => choose({ kind: "new" }, "region")}
              >
                <Icon name="crop" />
                <span className="ov-menu-text">
                  <span className="ov-menu-label">Companion · region</span>
                  <span className="ov-menu-sub" data-testid="region-note">
                    {companionCanCapture
                      ? "Region of your main display, captured by the companion"
                      : companionReason}
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="ov-menu-item"
                onClick={() => {
                  close();
                  props.onEditMask();
                }}
              >
                <Icon name="crop" />
                <span className="ov-menu-text">
                  <span className="ov-menu-label">Choose area…</span>
                  <span className="ov-menu-sub">
                    {masked
                      ? "Only the area you chose is captured"
                      : "Capture just part of the screen"}
                  </span>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
