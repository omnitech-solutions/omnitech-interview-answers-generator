// The region editor: a live local preview with a rectangle to drag and resize.
// Everything outside the rectangle is dimmed. The crop happens in this browser
// before anything is sent; the region is remembered per tenant.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LocalPreview } from "./local-preview";
import {
  describeArea,
  FULL,
  growRect,
  type Handle,
  isFull,
  moveRect,
  PRESETS,
  type Rect,
  resizeRect,
} from "./mask-geometry";
import { closeOnEscape, useDismiss } from "./use-dismiss";

const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_NAME: Record<Handle, string> = {
  nw: "top-left corner",
  n: "top edge",
  ne: "top-right corner",
  e: "right edge",
  se: "bottom-right corner",
  s: "bottom edge",
  sw: "bottom-left corner",
  w: "left edge",
};
const STEP = 0.01;
const STEP_LARGE = 0.05;

// The companion captures from the main display, so its region is drawn against
// the display, not against a shared window.
export const DISPLAY_MASK_NOTE =
  "The companion captures only this part of your main display; nothing outside it is sent.";
export const DISPLAY_TITLE = "Region of your main display";
export const BROWSER_TITLE = "Choose capture area";

export const MASK_NOTE =
  "The crop happens in your browser before anything is sent; pixels outside the mask never leave this device.";

// A small picture of the preset: the whole screen outlined, the chosen part filled.
function Glyph({ rect }: { rect: Rect }) {
  return (
    <svg
      viewBox="0 0 22 16"
      width="22"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="0.75"
        y="0.75"
        width="20.5"
        height="14.5"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x={0.75 + rect.x * 20.5}
        y={0.75 + rect.y * 14.5}
        width={rect.w * 20.5}
        height={rect.h * 14.5}
        rx="1.5"
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}

export function MaskEditor({
  stream,
  initial,
  onSave,
  onClose,
  variant = "browser",
}: {
  // "display": the region of the main display the companion captures (no preview
  // here: the companion takes the picture).
  variant?: "browser" | "display";
  stream: MediaStream | null;
  initial: Rect;
  onSave(rect: Rect): void;
  onClose(): void;
}) {
  const display = variant === "display";
  const [rect, setRect] = useState<Rect>(initial);
  const [aspect, setAspect] = useState(16 / 9);
  // The source's real size, known once its preview has loaded.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    handle: Handle | "move";
    startX: number;
    startY: number;
    from: Rect;
    pointerId: number;
  } | null>(null);
  useDismiss(root, true, onClose);
  // Focus goes into the sheet, and back to what opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement;
    box.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Tab stays inside the sheet.
  function trapTab(event: React.KeyboardEvent) {
    if (event.key !== "Tab") return;
    const focusable = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex="0"]',
      ) ?? []),
    ];
    // Document order, whatever order the selector list returned them in.
    focusable.sort((x, y) =>
      x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (
      event.shiftKey &&
      (active === first || !root.current?.contains(active))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onPointerDown(event: React.PointerEvent, handle: Handle | "move") {
    if (event.button !== 0) return;
    setDragging(true);
    drag.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      from: rect,
      pointerId: event.pointerId,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }
  function onPointerMove(event: React.PointerEvent) {
    const active = drag.current;
    const size = stage.current?.getBoundingClientRect();
    if (!active || active.pointerId !== event.pointerId || !size) return;
    if (!size.width || !size.height) return;
    const dx = (event.clientX - active.startX) / size.width;
    const dy = (event.clientY - active.startY) / size.height;
    setRect(
      active.handle === "move"
        ? moveRect(active.from, dx, dy)
        : resizeRect(active.from, active.handle, dx, dy),
    );
  }
  const endDrag = (event: React.PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  // Arrow keys move the region; Alt with an arrow resizes it around its centre.
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    const step = event.shiftKey ? STEP_LARGE : STEP;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = arrows[event.key];
    if (!dir) return;
    event.preventDefault();
    event.stopPropagation();
    setRect((current) =>
      event.altKey
        ? growRect(current, dir[0] * step, dir[1] * step)
        : moveRect(current, dir[0] * step, dir[1] * step),
    );
  }

  // A full-window sheet over the page this document shows (the Studio page for
  // the in-tab card; the whole window for the PiP and the standalone page),
  // portalled to <body> so the card's own box cannot clip it.
  return createPortal(
    <div className="ov-sheet" data-testid="mask-sheet">
      <div
        ref={root}
        className="ov-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={display ? DISPLAY_TITLE : BROWSER_TITLE}
        data-testid="mask-editor"
        onKeyDown={(event) => {
          closeOnEscape(onClose)(event);
          trapTab(event);
        }}
      >
        <div className="ov-modal-head">
          <strong>{display ? DISPLAY_TITLE : BROWSER_TITLE}</strong>
        </div>
        <div className="ov-stage-wrap">
          <div
            ref={stage}
            className="ov-stage"
            style={
              {
                aspectRatio: String(aspect),
                "--aspect": String(aspect),
              } as React.CSSProperties
            }
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {stream && !display ? (
              <LocalPreview
                stream={stream}
                className="ov-stage-video"
                onAspect={setAspect}
                onSize={(w, h) => setSize({ w, h })}
              />
            ) : (
              <span className="ov-stage-empty">
                {display
                  ? "Drag the rectangle over the part of your main display to capture."
                  : "Share a window, tab or screen to see it here. You can still set the region now."}
              </span>
            )}
            <div
              ref={box}
              className="ov-region"
              role="group"
              tabIndex={0}
              aria-label="Region. Arrow keys move it, Alt with arrow keys resizes it."
              data-testid="mask-rect"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
              onKeyDown={onKeyDown}
              onPointerDown={(event) => onPointerDown(event, "move")}
            >
              {HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`ov-handle-dot ov-h-${handle}`}
                  data-handle={handle}
                  title={`Resize ${HANDLE_NAME[handle]}`}
                  aria-hidden="true"
                  onPointerDown={(event) => onPointerDown(event, handle)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="ov-area-line">
          <span data-testid="mask-readout">
            {describeArea(
              rect,
              display ? "your main display" : "the shared screen",
            )}
          </span>
          {dragging && size && !display && (
            <span className="ov-muted ov-mono" data-testid="mask-pixels">
              {Math.round(rect.w * size.w)} × {Math.round(rect.h * size.h)} px
            </span>
          )}
        </div>
        <div className="ov-sheet-foot" data-testid="mask-foot">
          <p className="ov-menu-note">
            {display ? DISPLAY_MASK_NOTE : MASK_NOTE}
          </p>
          <div className="ov-presets" role="group" aria-label="Presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="ov-preset"
                aria-label={preset.label}
                title={preset.label}
                onClick={() => setRect(preset.rect)}
              >
                <Glyph rect={preset.rect} />
              </button>
            ))}
          </div>
          <div className="ov-modal-actions">
            <button
              type="button"
              className="ov-button"
              onClick={() => setRect(FULL)}
            >
              Reset
            </button>
            <span className="ov-spacer" />
            <button type="button" className="ov-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="ov-button primary"
              onClick={() => onSave(rect)}
            >
              {display ? "Save & capture" : "Save region"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
