// The screenshot viewer: a modal dialog (focus kept inside, Escape closes, focus
// returns to the thumbnail) with zoom in/out, Fit, 100% and pan by drag or the
// arrow keys. A staged image can also be cropped from here. Stored images load
// only from the existing authenticated route (`src`); staged ones from their
// own Blob URL. It draws no text from the screenshot, only the state of it.
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../icon";
import { CropEditor } from "./crop-editor";
import {
  ACTUAL,
  FIT,
  PAN_STEP,
  PAN_STEP_LARGE,
  pan,
  VIEWER_KEYS,
  type ViewState,
  zoom,
  zoomLabel,
} from "./image-viewer-model";
import type { CropRect } from "./screenshot-crop";
import { SENT_AS_LABEL } from "./screenshot-tray";
import type { ShotView } from "./use-screenshots-view";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const ARROW_PAN: Record<string, [number, number]> = {
  ArrowLeft: [PAN_STEP, 0],
  ArrowRight: [-PAN_STEP, 0],
  ArrowUp: [0, PAN_STEP],
  ArrowDown: [0, -PAN_STEP],
};

export function ImageViewer({
  shot,
  startInCrop = false,
  onCrop,
  cropDisabled = false,
  onClose,
}: {
  shot: ShotView;
  startInCrop?: boolean;
  // Present for a staged image: makes the new Blob and re-stages it.
  onCrop?: (rect: CropRect) => Promise<void>;
  // The tray is sending: a crop would be dropped, so Crop is off.
  cropDisabled?: boolean;
  onClose(): void;
}) {
  const [view, setView] = useState<ViewState>(FIT);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [cropping, setCropping] = useState(startInCrop && onCrop !== undefined);
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  // Focus moves in on open and back to what opened it on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // The scale Fit resolved to, for zooming out of Fit.
  const shown = (): number => {
    const box = image.current?.getBoundingClientRect();
    return box && box.width > 0 && natural.w > 0 ? box.width / natural.w : 1;
  };
  const run = (action: "in" | "out" | "fit" | "actual") =>
    setView((now) =>
      action === "fit"
        ? FIT
        : action === "actual"
          ? ACTUAL
          : zoom(now, action === "in" ? 1 : -1, shown(), natural),
    );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      // A crop in progress is never closed from under the person.
      if (cropBusy) return;
      if (cropping) setCropping(false);
      else onClose();
      return;
    }
    if (event.key === "Tab") {
      const nodes = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ];
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    // Keys that belong to a field or button inside stay theirs.
    const tag = (event.target as HTMLElement).tagName;
    if (cropping || tag === "INPUT") return;
    const keyed = VIEWER_KEYS.find((each) => each.match(event));
    if (keyed) {
      event.preventDefault();
      run(keyed.run);
      return;
    }
    const arrow = ARROW_PAN[event.key];
    if (arrow) {
      event.preventDefault();
      const k = event.shiftKey ? PAN_STEP_LARGE / PAN_STEP : 1;
      setView((now) => pan(now, arrow[0] * k, arrow[1] * k, natural));
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (view.fit) return;
    dragging.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = dragging.current;
    if (!from) return;
    dragging.current = { x: event.clientX, y: event.clientY };
    setView((now) =>
      pan(now, event.clientX - from.x, event.clientY - from.y, natural),
    );
  };

  const applyCrop = async (rect: CropRect) => {
    if (!onCrop) return;
    setCropBusy(true);
    setCropError(null);
    try {
      await onCrop(rect);
      onClose();
    } catch {
      setCropError("Couldn't crop that image. Try a different selection.");
      setCropBusy(false);
    }
  };

  const meta = [shot.time, shot.displayLabel, shot.text]
    .filter(Boolean)
    .join(" · ");
  // The viewer is portalled outside the panel root, so it reads the root's
  // clear-glass attribute itself (the scrim then dims less; the dialog stays dense).
  const clearGlass =
    document.querySelector(".pn-root")?.getAttribute("data-glass") === "clear";
  const body = (
    <div
      className="ss-viewer-scrim"
      {...(clearGlass ? { "data-glass": "clear" } : {})}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="ss-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`Screenshot ${shot.label}`}
        tabIndex={-1}
        data-testid="image-viewer"
        onKeyDown={onKeyDown}
      >
        <header className="ss-viewer-head">
          <div>
            <strong data-testid="viewer-label">{shot.label}</strong>
            {shot.staged && <span className="ss-badge">Not sent yet</span>}
            {shot.sentAs && (
              <span className="ss-badge" data-testid="viewer-sent-as">
                {SENT_AS_LABEL[shot.sentAs]}
              </span>
            )}
            {shot.willBe && (
              <span className="ss-badge" data-testid="viewer-will-be">
                {shot.willBe}
              </span>
            )}
            <p className="ss-meta" data-testid="viewer-meta">
              {meta}
            </p>
            {shot.sentLine && (
              <p className="ss-meta" data-testid="viewer-sent-line">
                {shot.sentLine}
              </p>
            )}
          </div>
          <button
            type="button"
            className="ss-icon"
            aria-label="Close viewer"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {cropping && shot.src ? (
          <CropEditor
            src={shot.src}
            busy={cropBusy}
            error={cropError}
            onApply={(rect) => void applyCrop(rect)}
            onCancel={() => setCropping(false)}
          />
        ) : (
          <>
            <div className="ss-viewer-tools" role="toolbar" aria-label="Zoom">
              <button
                type="button"
                className="ss-icon"
                aria-label="Zoom out"
                onClick={() => run("out")}
              >
                <Icon name="zoom_out" />
              </button>
              <output className="ss-zoom" data-testid="viewer-zoom">
                {zoomLabel(view)}
              </output>
              <button
                type="button"
                className="ss-icon"
                aria-label="Zoom in"
                onClick={() => run("in")}
              >
                <Icon name="zoom_in" />
              </button>
              <button
                type="button"
                className="ss-btn"
                aria-pressed={view.fit}
                onClick={() => run("fit")}
              >
                Fit
              </button>
              <button
                type="button"
                className="ss-btn"
                aria-pressed={!view.fit && view.scale === 1}
                onClick={() => run("actual")}
              >
                100%
              </button>
              {onCrop && shot.src && (
                <button
                  type="button"
                  className="ss-btn"
                  disabled={cropDisabled}
                  onClick={() => setCropping(true)}
                >
                  <Icon name="crop" /> Crop
                </button>
              )}
            </div>
            <div
              className="ss-viewer-stage"
              data-fit={view.fit || undefined}
              data-testid="viewer-stage"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => {
                dragging.current = null;
              }}
            >
              {shot.src ? (
                <img
                  ref={image}
                  src={shot.src}
                  alt={`Screenshot ${shot.label}`}
                  draggable={false}
                  onLoad={(event) =>
                    setNatural({
                      w: event.currentTarget.naturalWidth,
                      h: event.currentTarget.naturalHeight,
                    })
                  }
                  style={
                    view.fit
                      ? undefined
                      : {
                          width: natural.w * view.scale || undefined,
                          maxWidth: "none",
                          maxHeight: "none",
                          transform: `translate(${view.x}px, ${view.y}px)`,
                        }
                  }
                />
              ) : (
                <p className="ss-meta">This image is no longer stored.</p>
              )}
            </div>
            <p className="ss-keys" data-testid="viewer-keys">
              Keys:{" "}
              {VIEWER_KEYS.map((each) => `${each.keys} ${each.does}`).join(
                ", ",
              )}
              , arrow keys pan (Shift for more), Esc close
            </p>
          </>
        )}
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
