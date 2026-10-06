// The Mini player: a small always-on-top card for when the window should stay
// out of the way. The dots, capture, microphone and See-through control of the
// toolbar, the task on show (name, stage, one-line headline, what may be
// missing), Stop analysis and Pause or Resume, and a Back to normal button.
// Every value comes from the one panel session; the panes are not drawn.
import type { PresentationHost } from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { Icon } from "../../../icon";
import type { CommandResult } from "../../session-snapshot";
import { failureNote } from "../overlay-footer";
import { canPassThrough } from "./hit-regions";
import { headlineOf, miniStage, missingHint } from "./mini-model";
import type { PanelGlass } from "./panel-glass";
import type { PanelSession } from "./panel-views";
import { CaptureButton, MicButton, SeeThroughButton } from "./toolbar";
import { footerButtons } from "./toolbar-config";
import { WindowDots } from "./window-dots";
import type { PanelWindowMode } from "./window-mode";

export function MiniPlayer({
  s,
  presentation,
  glass,
  windowMode,
  onMenuOpen,
}: {
  s: PanelSession;
  presentation: PresentationHost;
  glass: PanelGlass;
  windowMode: PanelWindowMode;
  onMenuOpen(open: boolean): void;
}) {
  const [popup, setPopup] = useState(false);
  useEffect(() => onMenuOpen(popup), [popup, onMenuOpen]);
  const stage = miniStage({
    open: s.open,
    phase: s.phase,
    activityKey: s.model.activity.key,
    card: s.card,
  });
  const headline = headlineOf(s.card?.answerText ?? null);
  const missing = s.missing?.length ?? 0;
  const pause = footerButtons(
    {
      kind: "live",
      paused: s.paused,
      busy:
        s.snapshot.pending.includes("pause") ||
        s.snapshot.pending.includes("resume"),
    },
    "short",
  ).find((button) => button.id === "pause" || button.id === "resume");
  const run = (work: Promise<CommandResult>) =>
    void work.then((result) => {
      if (!result.ok) s.notify(failureNote(result.code, result.reason));
    });
  return (
    <>
      <div
        className="pn-pill pn-mini-pill"
        role="toolbar"
        aria-label="Session controls"
        data-testid="pn-pill"
      >
        <WindowDots
          s={s}
          presentation={presentation}
          windowMode={windowMode}
          onPopup={setPopup}
        />
        <div className="pn-split" data-stop={s.phase ? "true" : undefined}>
          <CaptureButton s={s} />
        </div>
        <MicButton s={s} />
        <SeeThroughButton
          glass={glass}
          passThrough={canPassThrough(presentation)}
        />
        <span className="pn-fill" />
        <button
          type="button"
          className="pn-mini-button pn-mini-back"
          data-testid="pn-mini-back"
          title="Back to the normal window"
          onClick={() => windowMode.set("normal")}
        >
          <Icon name="close_fullscreen" />
          Back to normal
        </button>
      </div>
      <div className="pn-mini-card" data-testid="pn-mini-card">
        <div className="pn-mini-head">
          <strong className="pn-mini-name" data-testid="pn-mini-name">
            {s.card ? `${s.card.label} · ${s.card.name}` : "No task yet"}
          </strong>
          {stage && (
            <span className="pn-mini-stage" data-testid="pn-mini-stage">
              {stage}
            </span>
          )}
        </div>
        {headline && (
          <p className="pn-mini-headline" data-testid="pn-mini-headline">
            {headline}
          </p>
        )}
        <div className="pn-mini-actions">
          {missing > 0 && (
            <span className="pn-mini-missing" data-testid="pn-mini-missing">
              <Icon name="info" />
              {missingHint(missing)}
            </span>
          )}
          <span className="pn-fill" />
          {s.phase && (
            <button
              type="button"
              className="pn-mini-button"
              data-testid="pn-mini-stop"
              onClick={() => void s.stop()}
            >
              <Icon name="stop_circle" />
              Stop analysis
            </button>
          )}
          {s.open && pause && (
            <button
              type="button"
              className="pn-mini-button"
              data-action={pause.id === "resume" ? "resume" : undefined}
              data-testid={`pn-mini-${pause.id}`}
              title={pause.title}
              disabled={pause.disabled}
              onClick={() =>
                run(
                  pause.id === "resume"
                    ? s.actions.resume()
                    : s.actions.pause(),
                )
              }
            >
              {pause.icon && <Icon name={pause.icon} />}
              {pause.label}
            </button>
          )}
        </div>
      </div>
      <div className="pn-mini-foot">
        <span className="pn-fill" />
        <span
          className="ov-clock"
          role="timer"
          aria-label={`Session time ${s.model.elapsedLabel}${s.paused ? ", paused" : ""}`}
          data-paused={s.paused ? "true" : undefined}
          data-testid="ov-clock"
        >
          <span className="ov-clock-dot" aria-hidden="true" />
          {s.model.elapsedLabel}
        </span>
      </div>
    </>
  );
}
