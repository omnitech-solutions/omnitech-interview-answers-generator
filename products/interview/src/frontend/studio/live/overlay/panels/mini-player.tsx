// The Mini player: a small always-on-top card for when the window should stay
// out of the way. The dots, capture, microphone and See-through control of the
// toolbar, the task on show (name, stage, one-line headline, what may be
// missing), Stop analysis and Pause or Resume, and a Back to normal button.
// Every value comes from the one panel session; the panes are not drawn.

import { Button, Panel } from "@oc-tech/omni-ui-components";
import type { PresentationHost } from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { Icon } from "../../../icon";
import type { CommandResult } from "../../session-snapshot";
import { failureNote, SessionClock } from "../overlay-footer";
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
        data-drag-handle=""
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
        <Button
          variant="outline"
          tone="neutral"
          soft
          buttonSize="control"
          data-testid="pn-mini-back"
          title="Back to the normal window"
          icon={<Icon name="close_fullscreen" />}
          onClick={() => windowMode.set("normal")}
        >
          Back to normal
        </Button>
      </div>
      <Panel
        className="pn-mini-card"
        data-testid="pn-mini-card"
        title={
          <span data-testid="pn-mini-name">
            {s.card ? `${s.card.label} · ${s.card.name}` : "No task yet"}
          </span>
        }
        meta={
          stage ? <span data-testid="pn-mini-stage">{stage}</span> : undefined
        }
        actions={
          <>
            {s.phase && (
              <Button
                variant="outline"
                tone="neutral"
                soft
                buttonSize="sm"
                data-testid="pn-mini-stop"
                icon={<Icon name="stop_circle" />}
                onClick={() => void s.stop()}
              >
                Stop analysis
              </Button>
            )}
            {s.open && pause && (
              <Button
                {...(pause.id === "resume"
                  ? { tone: "success" as const, fillIcon: true }
                  : {
                      variant: "outline" as const,
                      tone: "neutral" as const,
                      soft: true,
                      fillIcon: true,
                    })}
                buttonSize="sm"
                data-testid={`pn-mini-${pause.id}`}
                title={pause.title}
                disabled={pause.disabled}
                icon={
                  <Icon
                    name={pause.id === "resume" ? "play_arrow" : "pause"}
                    filled
                  />
                }
                onClick={() =>
                  run(
                    pause.id === "resume"
                      ? s.actions.resume()
                      : s.actions.pause(),
                  )
                }
              >
                {pause.label}
              </Button>
            )}
          </>
        }
        bodyPadding="sm"
      >
        {headline && (
          <p className="pn-mini-headline" data-testid="pn-mini-headline">
            {headline}
          </p>
        )}
        {missing > 0 && (
          <span className="pn-mini-missing" data-testid="pn-mini-missing">
            <Icon name="info" />
            {missingHint(missing)}
          </span>
        )}
      </Panel>
      <div className="pn-mini-foot">
        <span className="pn-fill" />
        <SessionClock elapsed={s.model.elapsedLabel} paused={s.paused} />
      </div>
    </>
  );
}
