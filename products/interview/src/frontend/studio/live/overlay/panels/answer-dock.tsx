// The "To apply" dock at the bottom of the Answer panel: the screenshots staged
// on the device, waiting for Apply. It shows only while something is staged.
// One row of controls (count, thumbnails, Add screenshot, Clear, Apply); the
// model is the shared tray (use-screenshots-view.ts), unchanged.
import { ActionMenu, Button } from "@oc-tech/omni-ui-components";
import {
  LIVE_OWNER_LANGUAGE_LABELS,
  LIVE_OWNER_LANGUAGES,
  type LiveOwnerLanguage,
} from "@omnitech/interview-contracts";
import { type DragEvent, useId, useRef, useState } from "react";
import { Icon } from "../../../icon";
import { ImageViewer } from "../../shared/image-viewer";
import { cropBlob } from "../../shared/screenshot-crop";
import type { TrayIntent } from "../../shared/screenshot-tray";
import type {
  ScreenshotsView,
  ShotView,
} from "../../shared/use-screenshots-view";

function Thumb({
  shot,
  index,
  busy,
  view,
  onOpen,
}: {
  shot: ShotView;
  index: number;
  busy: boolean;
  view: ScreenshotsView;
  onOpen(): void;
}) {
  const { tray } = view;
  const dragged = useRef<string | null>(null);
  // Dropping on a thumbnail moves the dragged one to that place, a step at a time.
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
    <li
      className="pn-dock-thumb"
      draggable={!busy}
      data-testid={`staged-${index + 1}`}
      title={`${shot.label}${shot.displayLabel ? ` · ${shot.displayLabel}` : ""} · Not sent yet`}
      onDragStart={() => {
        dragged.current = shot.key;
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => drop(event, shot.key)}
    >
      <button
        type="button"
        className="pn-dock-thumb-open"
        aria-label={`Open ${shot.label}`}
        data-testid={`shot-${shot.label}`}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (!event.altKey) return;
          const by =
            event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          if (by === 0) return;
          event.preventDefault();
          tray.move(shot.key, by);
        }}
      >
        {shot.src ? (
          <img src={shot.src} alt="" draggable={false} />
        ) : (
          <Icon name="screenshot_monitor" />
        )}
      </button>
      <button
        type="button"
        className="pn-dock-thumb-remove"
        aria-label={`Remove ${shot.label}`}
        disabled={busy}
        onClick={() => tray.remove(shot.key)}
      >
        <Icon name="close" />
      </button>
      <span className="pn-sr">Not sent yet</span>
      {shot.displayLabel && <span className="pn-sr">{shot.displayLabel}</span>}
      {shot.willBe && (
        <span className="pn-sr" data-testid={`will-be-${index + 1}`}>
          {shot.willBe}
        </span>
      )}
      <span className="pn-sr" data-testid={`ocr-${index + 1}`}>
        {shot.text}
      </span>
    </li>
  );
}

export function AnswerDock({
  view,
  onAdd,
  captureUnavailable,
  language,
  onLanguage,
}: {
  view: ScreenshotsView;
  // Takes one capture and stages it (nothing is sent).
  onAdd(intent: TrayIntent): void;
  // Why capturing is not possible here now, if it is not.
  captureUnavailable: string | null;
  // The code language the solution is generated in, chosen before it is sent.
  language: LiveOwnerLanguage | "auto";
  onLanguage(next: LiveOwnerLanguage | "auto"): void;
}) {
  const { tray, staged } = view;
  const [viewing, setViewing] = useState<string | null>(null);
  const notice = useId();
  const busy = tray.applying;
  const addReason = tray.addDisabledReason ?? captureUnavailable;
  const open = viewing
    ? staged.find((shot) => shot.key === viewing)
    : undefined;
  const openItem = open
    ? tray.items.find((item) => item.id === open.key)
    : undefined;
  return (
    <div className="pn-dock" data-testid="screenshot-tray">
      <div className="pn-dock-row">
        <span className="pn-dock-count">To apply · {staged.length}</span>
        <ol
          className="pn-dock-thumbs"
          aria-label="Screenshots to apply, in order"
        >
          {staged.map((shot, index) => (
            <Thumb
              key={shot.key}
              shot={shot}
              index={index}
              busy={busy}
              view={view}
              onOpen={() => setViewing(shot.key)}
            />
          ))}
        </ol>
        <Button
          buttonSize="sm"
          variant="outline"
          className="pn-dock-add"
          icon={<Icon name="add" />}
          disabled={addReason !== null}
          aria-describedby={addReason ? notice : undefined}
          title="Add screenshot"
          data-testid="add-screenshot"
          // [GUARD] A screenshot added while a task is on show always adds to
          // it (a revision). A new task comes only from Capture new problem,
          // the toolbar's capture or an automatic capture: never from here,
          // whatever intent an earlier staging left behind.
          onClick={() => onAdd(tray.hasTarget ? "add" : "new")}
        >
          <span className="pn-dock-add-label">Add screenshot</span>
        </Button>
        {/* The language is chosen here, before anything is sent: the wrong
            one costs a whole generation. */}
        <ActionMenu
          label="Solution language"
          title="Generate in"
          width={240}
          sections={[
            {
              id: "language",
              selection: "single",
              value: language,
              items: [
                { id: "auto", label: "Detected from the screen" },
                ...LIVE_OWNER_LANGUAGES.map((id) => ({
                  id,
                  label: LIVE_OWNER_LANGUAGE_LABELS[id],
                })),
              ],
            },
          ]}
          onValueChange={(_group, id) =>
            onLanguage(id as LiveOwnerLanguage | "auto")
          }
          trigger={
            <Button
              buttonSize="sm"
              variant="outline"
              icon={<Icon name="code" />}
              iconAfter={<Icon name="expand_more" />}
              disabled={busy}
              aria-label="Solution language"
              data-testid="dock-language"
            >
              {language === "auto"
                ? "Language: auto"
                : LIVE_OWNER_LANGUAGE_LABELS[language]}
            </Button>
          }
        />
      </div>
      {/* The two actions sit at the right, under the row of inputs. The
          layout is set here, not in the stylesheet: the native window keeps
          a stylesheet until it reloads, and this row must never be wrong. */}
      <div
        className="pn-dock-row"
        style={{ width: "100%", justifyContent: "flex-end" }}
      >
        <Button
          buttonSize="sm"
          variant="ghost"
          disabled={busy}
          data-testid="discard-screenshots"
          onClick={tray.discard}
        >
          Cancel
        </Button>
        <Button
          buttonSize="sm"
          tone="accent"
          disabled={!tray.canApply}
          title={tray.sends}
          data-testid="apply-screenshots"
          onClick={() => void tray.apply()}
        >
          {tray.failure === "request" ? "Retry" : "Generate Solution"}
        </Button>
      </div>
      {addReason && (
        <p id={notice} className="pn-dock-note" data-testid="add-reason">
          {addReason}
        </p>
      )}
      <span className="pn-sr" data-testid="tray-sends">
        {tray.sends}
      </span>
      {busy && (
        <p className="pn-dock-note" role="status" data-testid="tray-status">
          {tray.reading
            ? "Reading text..."
            : tray.intent === "add" && tray.hasTarget
              ? `Regenerating ${view.taskLabel ?? "the task"}...`
              : "Sending..."}
        </p>
      )}
      {tray.failureText && (
        <p
          className="pn-dock-note"
          data-tone="bad"
          role="alert"
          data-testid="tray-error"
        >
          {tray.failureText}
        </p>
      )}
      {open && (
        <ImageViewer
          shot={open}
          {...(openItem
            ? {
                onCrop: async (rect) => {
                  tray.crop(openItem.id, await cropBlob(openItem.blob, rect));
                },
              }
            : {})}
          cropDisabled={busy}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
