// The Screenshots icon (with its count) and the area it opens under the task
// line, for the native answer pane and the web task panel alike. One model
// (use-screenshots-view.ts), one set of parts; a variant only picks class names.
//
//   Auto:   a minimised, horizontally scrolling strip of the task's stored
//           screenshots, closed until the icon is pressed (open once something
//           is staged).
//   Manual: the same area is the STAGING TRAY, open by default: capture stages
//           on the device ("Not sent yet"), each image can be cropped, removed
//           and reordered, and ONE Apply makes the request.
import {
  type DragEvent,
  type KeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";
import { Icon } from "../../icon";
import { ImageViewer } from "./image-viewer";
import { cropBlob } from "./screenshot-crop";
import { screenshotSendTooltip } from "./screenshot-send";
import { SENT_AS_LABEL, type TrayIntent } from "./screenshot-tray";
import type { ScreenshotsView, ShotView } from "./use-screenshots-view";

// Per surface: the class names its stylesheet already has.
const VARIANT = {
  native: { toggle: "pn-mini-button" },
  web: { toggle: "live-chip live-chip-button" },
} as const;
export type ScreenshotsVariant = keyof typeof VARIANT;

// The strip shows arrows once it can hold more than this many thumbnails.
const ARROWS_FROM = 3;
const SCROLL_STEP = 180;

export function ScreenshotsToggle({
  view,
  variant,
  controls,
}: {
  view: ScreenshotsView;
  variant: ScreenshotsVariant;
  // The id of the area it opens (see `areaId`).
  controls: string;
}) {
  const { tray, count } = view;
  return (
    <button
      type="button"
      className={VARIANT[variant].toggle}
      aria-label={`Screenshots (${count})`}
      aria-expanded={tray.open}
      aria-controls={controls}
      title={`${tray.open ? "Hide screenshots" : "Show screenshots"}. ${screenshotSendTooltip(tray.screenshotSend)}`}
      data-testid="screenshots-toggle"
      onClick={() => tray.setOpen(!tray.open)}
    >
      <Icon name="screenshot_monitor" />
      <span
        className="ss-count"
        data-testid="screenshots-count"
        aria-hidden="true"
      >
        {count}
      </span>
    </button>
  );
}

// One thumbnail: opens the viewer. Reads as "S3, 10:42, Display 2 of 3".
function Thumb({
  shot,
  onOpen,
  onKeyDown,
}: {
  shot: ShotView;
  onOpen(): void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="ss-thumb"
      aria-label={`Open ${shot.label}`}
      data-testid={`shot-${shot.label}`}
      onClick={onOpen}
      {...(onKeyDown ? { onKeyDown } : {})}
    >
      {shot.src ? (
        <img src={shot.src} alt="" draggable={false} />
      ) : (
        <span className="ss-thumb-empty">No image</span>
      )}
    </button>
  );
}

const CaptionLines = ({ shot }: { shot: ShotView }) => (
  <span className="ss-caption">
    <strong>{shot.label}</strong>
    {shot.time && <span>{shot.time}</span>}
    {shot.displayLabel && <span>{shot.displayLabel}</span>}
    {shot.revisions.length > 0 && (
      <span>
        {shot.revisions.length === 1 ? "rev " : "revs "}
        {shot.revisions.join(", ")}
      </span>
    )}
    {shot.sentAs && (
      <span data-testid="sent-as" title={shot.sentLine ?? undefined}>
        {SENT_AS_LABEL[shot.sentAs]}
      </span>
    )}
  </span>
);

function Strip({
  shots,
  onOpen,
}: {
  shots: readonly ShotView[];
  onOpen(key: string): void;
}) {
  const track = useRef<HTMLUListElement>(null);
  const scroll = (direction: -1 | 1) =>
    track.current?.scrollBy?.({
      left: direction * SCROLL_STEP,
      behavior: "smooth",
    });
  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    scroll(event.key === "ArrowLeft" ? -1 : 1);
  };
  return (
    <div className="ss-strip-wrap">
      {shots.length >= ARROWS_FROM && (
        <button
          type="button"
          className="ss-icon"
          aria-label="Scroll screenshots left"
          onClick={() => scroll(-1)}
        >
          <Icon name="chevron_left" />
        </button>
      )}
      {/* A scroll container takes focus so the arrow keys can scroll it. */}
      <ul
        ref={track}
        className="ss-strip"
        aria-label="Screenshots of this task"
        data-testid="screenshot-strip"
        tabIndex={0}
        onKeyDown={onKey}
      >
        {shots.map((shot) => (
          <li key={shot.key} className="ss-item">
            <Thumb shot={shot} onOpen={() => onOpen(shot.key)} />
            <CaptionLines shot={shot} />
          </li>
        ))}
      </ul>
      {shots.length >= ARROWS_FROM && (
        <button
          type="button"
          className="ss-icon"
          aria-label="Scroll screenshots right"
          onClick={() => scroll(1)}
        >
          <Icon name="chevron_right" />
        </button>
      )}
    </div>
  );
}

function StagedList({
  view,
  onOpen,
}: {
  view: ScreenshotsView;
  onOpen(key: string, crop: boolean): void;
}) {
  const { tray, staged } = view;
  const dragged = useRef<string | null>(null);
  const busy = tray.applying;
  // Dropping on a card moves the dragged one to that place, a step at a time.
  const drop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    const id = dragged.current;
    dragged.current = null;
    if (!id || id === targetId || busy) return;
    const from = tray.items.findIndex((item) => item.id === id);
    const to = tray.items.findIndex((item) => item.id === targetId);
    const by = to > from ? 1 : -1;
    for (let n = 0; n < Math.abs(to - from); n += 1) tray.move(id, by);
  };
  return (
    <ol className="ss-staged" aria-label="Screenshots to apply, in order">
      {staged.map((shot, index) => (
        <li
          key={shot.key}
          className="ss-item staged"
          draggable={!busy}
          data-testid={`staged-${index + 1}`}
          onDragStart={() => {
            dragged.current = shot.key;
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => drop(event, shot.key)}
        >
          <Thumb
            shot={shot}
            onOpen={() => onOpen(shot.key, false)}
            onKeyDown={(event) => {
              if (!event.altKey) return;
              const by =
                event.key === "ArrowLeft"
                  ? -1
                  : event.key === "ArrowRight"
                    ? 1
                    : null;
              if (by === null) return;
              event.preventDefault();
              tray.move(shot.key, by);
            }}
          />
          <CaptionLines shot={shot} />
          <span className="ss-badge">Not sent yet</span>
          {shot.willBe && (
            <span className="ss-meta" data-testid={`will-be-${index + 1}`}>
              {shot.willBe}
            </span>
          )}
          <span className="ss-meta" data-testid={`ocr-${index + 1}`}>
            {shot.text}
          </span>
          <span className="ss-actions">
            <button
              type="button"
              className="ss-icon"
              aria-label={`Crop ${shot.label}`}
              disabled={busy || !shot.src}
              onClick={() => onOpen(shot.key, true)}
            >
              <Icon name="crop" />
            </button>
            <button
              type="button"
              className="ss-icon"
              aria-label={`Move ${shot.label} left`}
              disabled={busy || index === 0}
              onClick={() => tray.move(shot.key, -1)}
            >
              <Icon name="arrow_back" />
            </button>
            <button
              type="button"
              className="ss-icon"
              aria-label={`Move ${shot.label} right`}
              disabled={busy || index === staged.length - 1}
              onClick={() => tray.move(shot.key, 1)}
            >
              <Icon name="arrow_forward" />
            </button>
            <button
              type="button"
              className="ss-icon"
              aria-label={`Remove ${shot.label}`}
              disabled={busy}
              onClick={() => tray.remove(shot.key)}
            >
              <Icon name="delete" />
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ScreenshotsArea({
  view,
  id,
  variant,
  onAdd,
  onAddContext,
  captureUnavailable = null,
  hideTray = false,
}: {
  view: ScreenshotsView;
  id: string;
  variant: ScreenshotsVariant;
  // Takes one capture and stages it (surface-specific; nothing is sent).
  onAdd(intent: TrayIntent): void;
  // Puts the person in the composer to add context in words (optional).
  onAddContext?: () => void;
  // Why capturing is not possible on this page right now, if it is not.
  captureUnavailable?: string | null;
  // The staging tray is drawn elsewhere (the native Answer panel's dock): show
  // only the stored screenshots here.
  hideTray?: boolean;
}) {
  const { tray, stored, staged } = view;
  const [viewing, setViewing] = useState<{ key: string; crop: boolean } | null>(
    null,
  );
  const notice = useId();
  if (!tray.open) return null;
  if (hideTray && stored.length === 0 && !view.loading && !view.error)
    return null;
  const addReason = tray.addDisabledReason ?? captureUnavailable;
  const showApply = staged.length > 0 || tray.hasTarget;
  const open = viewing
    ? [...stored, ...staged].find((shot) => shot.key === viewing.key)
    : undefined;
  const openStaged = open?.staged
    ? tray.items.find((item) => item.id === open.key)
    : undefined;
  return (
    <section
      id={id}
      className="ss"
      data-variant={variant}
      data-mode={tray.mode}
      aria-label="Screenshots"
      data-testid="screenshots-area"
    >
      {(stored.length > 0 || view.loading || view.error) && (
        <div className="ss-block">
          <h4 className="ss-title">
            {view.taskLabel ? `${view.taskLabel} screenshots` : "Screenshots"}
          </h4>
          {stored.length > 0 && (
            <Strip
              shots={stored}
              onOpen={(key) => setViewing({ key, crop: false })}
            />
          )}
          {view.loading && stored.length === 0 && (
            <p className="ss-meta" role="status">
              Loading screenshots...
            </p>
          )}
          {view.error && stored.length === 0 && (
            <p className="ss-meta" role="status">
              Couldn't load this task's screenshots.
            </p>
          )}
        </div>
      )}
      {!hideTray && (
        <div className="ss-block" data-testid="screenshot-tray">
          <div className="ss-row">
            {staged.length > 0 && (
              <h4 className="ss-title">{`To apply (${staged.length})`}</h4>
            )}
            <button
              type="button"
              className="ss-btn"
              disabled={addReason !== null}
              aria-describedby={addReason ? notice : undefined}
              data-testid="add-screenshot"
              // [GUARD] A screenshot added while a task is on show always adds to
              // it (a revision). A new task comes only from Capture new problem,
              // the toolbar's capture or an automatic capture: never from here,
              // whatever intent an earlier staging left behind.
              onClick={() => onAdd(tray.hasTarget ? "add" : "new")}
            >
              <Icon name="add" /> Add screenshot
            </button>
            {onAddContext && (
              <button
                type="button"
                className="ss-btn"
                data-testid="add-context"
                onClick={onAddContext}
              >
                <Icon name="edit" /> Add context
              </button>
            )}
          </div>
          {addReason && (
            <p id={notice} className="ss-meta" data-testid="add-reason">
              {addReason}
            </p>
          )}
          {staged.length > 0 && (
            <StagedList
              view={view}
              onOpen={(key, crop) => setViewing({ key, crop })}
            />
          )}
          <p className="ss-meta" data-testid="tray-sends">
            {tray.sends}
          </p>
          {tray.applying && (
            <p className="ss-meta" role="status" data-testid="tray-status">
              {tray.reading
                ? "Reading text..."
                : tray.intent === "add" && tray.hasTarget
                  ? `Regenerating ${view.taskLabel ?? "the task"}...`
                  : "Sending..."}
            </p>
          )}
          {tray.failureText && (
            <p className="ss-error" role="alert" data-testid="tray-error">
              {tray.failureText}
            </p>
          )}
          {showApply && (
            <div className="ss-row">
              <button
                type="button"
                className="ss-btn primary"
                disabled={!tray.canApply}
                data-testid="apply-screenshots"
                onClick={() => void tray.apply()}
              >
                {tray.failure === "request" ? "Retry" : "Apply"}
              </button>
              {staged.length > 0 && (
                <button
                  type="button"
                  className="ss-btn"
                  disabled={tray.applying}
                  data-testid="discard-screenshots"
                  onClick={tray.discard}
                >
                  Discard
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {open && (
        <ImageViewer
          shot={open}
          startInCrop={viewing?.crop ?? false}
          {...(openStaged
            ? {
                onCrop: async (rect) => {
                  tray.crop(
                    openStaged.id,
                    await cropBlob(openStaged.blob, rect),
                  );
                },
              }
            : {})}
          cropDisabled={tray.applying}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}

// A stable id for the toggle's `aria-controls` and the area.
export const useAreaId = (): string => `ss-${useId().replace(/:/g, "")}`;
