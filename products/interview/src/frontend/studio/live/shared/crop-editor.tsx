// Crop one staged screenshot: drag a free (aspect-free) selection on the image,
// resize it from eight handles, or type exact pixels. Handles are buttons, so
// the arrow keys nudge them. The editor only reports the rectangle; the caller
// makes the new Blob (screenshot-crop.ts) and the tray re-reads its text.
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import {
  CROP_HANDLES,
  type CropHandleId,
  type CropRect,
  dragRect,
  fullRect,
  isWholeImage,
  MIN_CROP_SIDE,
  rectBetween,
  type Size,
  withField,
} from "./screenshot-crop";

const FIELDS: { field: keyof CropRect; label: string }[] = [
  { field: "x", label: "Left" },
  { field: "y", label: "Top" },
  { field: "w", label: "Width" },
  { field: "h", label: "Height" },
];
const NUDGE = 1;
const NUDGE_LARGE = 10;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function CropEditor({
  src,
  busy,
  error,
  onApply,
  onCancel,
}: {
  src: string;
  busy: boolean;
  error: string | null;
  onApply(rect: CropRect): void;
  onCancel(): void;
}) {
  const [size, setSize] = useState<Size | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{
    handle: CropHandleId | "new";
    start: CropRect;
    at: { x: number; y: number };
    origin: { x: number; y: number };
  } | null>(null);

  // Image pixels per screen pixel (1 until the image has a layout).
  const ratio = (): number => {
    const box = image.current?.getBoundingClientRect();
    return box && box.width > 0 && size ? size.w / box.width : 1;
  };
  const point = (event: PointerEvent): { x: number; y: number } => {
    const box = image.current?.getBoundingClientRect();
    const k = ratio();
    return {
      x: (event.clientX - (box?.left ?? 0)) * k,
      y: (event.clientY - (box?.top ?? 0)) * k,
    };
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!size || !rect || busy) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-handle]",
    );
    const at = { x: event.clientX, y: event.clientY };
    const handle =
      (target?.dataset["handle"] as CropHandleId | undefined) ?? "new";
    drag.current = { handle, start: rect, at, origin: point(event) };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || !size) return;
    if (active.handle === "new") {
      setRect(rectBetween(active.origin, point(event), size));
      return;
    }
    const k = ratio();
    setRect(
      dragRect(
        active.start,
        active.handle,
        (event.clientX - active.at.x) * k,
        (event.clientY - active.at.y) * k,
        size,
      ),
    );
  };
  const onUp = () => {
    drag.current = null;
  };

  const onHandleKey = (event: KeyboardEvent, handle: CropHandleId) => {
    const arrow = ARROWS[event.key];
    if (!arrow || !rect || !size || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
    setRect(dragRect(rect, handle, arrow[0] * step, arrow[1] * step, size));
  };

  const percent = (value: number, of: number) => `${(value / of) * 100}%`;
  const whole = size && rect ? isWholeImage(rect, size) : true;
  return (
    <div className="ss-crop" data-testid="crop-editor">
      <div
        className="ss-crop-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img
          ref={image}
          src={src}
          alt="Screenshot to crop"
          draggable={false}
          onLoad={(event) => {
            const next = {
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            };
            setSize(next);
            setRect(fullRect(next));
          }}
        />
        {size && rect && (
          <div
            className="ss-crop-box"
            data-handle="move"
            data-testid="crop-box"
            style={{
              left: percent(rect.x, size.w),
              top: percent(rect.y, size.h),
              width: percent(rect.w, size.w),
              height: percent(rect.h, size.h),
            }}
          >
            {CROP_HANDLES.map((handle) => (
              <button
                key={handle.id}
                type="button"
                className="ss-crop-handle"
                data-handle={handle.id}
                data-testid={`crop-handle-${handle.id}`}
                aria-label={`Crop edge: ${handle.label}`}
                onKeyDown={(event) => onHandleKey(event, handle.id)}
              />
            ))}
          </div>
        )}
      </div>
      {size && rect && (
        <div className="ss-crop-fields">
          {FIELDS.map(({ field, label }) => (
            <label key={field}>
              {label}
              <input
                type="number"
                inputMode="numeric"
                value={rect[field]}
                min={field === "x" || field === "y" ? 0 : MIN_CROP_SIDE}
                disabled={busy}
                onChange={(event) =>
                  setRect(
                    withField(rect, field, event.target.valueAsNumber, size),
                  )
                }
              />
            </label>
          ))}
          <output data-testid="crop-output">
            Output {rect.w} × {rect.h} px (at least {MIN_CROP_SIDE})
          </output>
        </div>
      )}
      {error && (
        <p className="ss-error" role="alert">
          {error}
        </p>
      )}
      <div className="ss-row">
        <button
          type="button"
          className="ss-btn"
          disabled={busy || !size}
          onClick={() => size && setRect(fullRect(size))}
        >
          Reset
        </button>
        <button
          type="button"
          className="ss-btn"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="ss-btn primary"
          disabled={busy || whole || !rect}
          onClick={() => rect && onApply(rect)}
        >
          {busy ? "Cropping..." : "Apply crop"}
        </button>
      </div>
    </div>
  );
}
