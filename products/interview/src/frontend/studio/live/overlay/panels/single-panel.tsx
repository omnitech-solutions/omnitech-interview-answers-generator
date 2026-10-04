// The minimized view: the toolbar, the chat, the analysis and the code in ONE
// window the person can move and resize. The toolbar is the pivot: it stays at
// the centre, and showing or hiding a pane widens or narrows the window evenly
// around it. The toolbar carries what the card's footer did (Pause or Resume, End
// with its confirmation, a start button once the session ended); the footer keeps
// the honest "Visible window" note and the build id.
import type { PresentationHost } from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../icon";
import { failureNote, Footer } from "../overlay-footer";
import { AUTO_SESSION } from "./auto-session";
import { openPanelBus } from "./panel-bus";
import {
  AnalysisPanel,
  ChatPanel,
  type PanelSession,
  PillPanel,
} from "./panel-views";

// What each pane needs, and what the toolbar alone needs (CSS px).
export const PANE_WIDTH = { chat: 320, analysis: 480, code: 420 } as const;
export const BARE_WIDTH = 340;
const GAP = 8;
const PAD = 16;

export function windowWidthFor(shown: {
  chat: boolean;
  analysis: boolean;
  code: boolean;
}): number {
  const widths = (["chat", "analysis", "code"] as const)
    .filter((pane) => shown[pane])
    .map((pane) => PANE_WIDTH[pane]);
  if (widths.length === 0) return BARE_WIDTH;
  return (
    widths.reduce((sum, width) => sum + width, 0) +
    GAP * (widths.length - 1) +
    PAD
  );
}

export type Panes = {
  shown: { chat: boolean; analysis: boolean; code: boolean };
  toggle(pane: "chat" | "analysis" | "code"): void;
};

// Which panes of the one window are showing. The code opens with the analysis:
// expanded by default. While `active`, the shell widens or narrows the window
// about its centre to fit what is shown.
export function usePanes(
  presentation: PresentationHost,
  active: boolean,
): Panes {
  const [shown, setShown] = useState({
    chat: true,
    analysis: true,
    code: true,
  });
  useEffect(() => {
    if (active) void presentation.setWindowWidth?.(windowWidthFor(shown));
  }, [active, shown, presentation]);
  return {
    shown,
    toggle: (pane) => setShown((now) => ({ ...now, [pane]: !now[pane] })),
  };
}

export function SinglePanel({
  s,
  panes: { shown, toggle },
}: {
  s: PanelSession;
  panes: Panes;
}) {
  const [confirming, setConfirming] = useState(false);
  // The session ended (End, or the server's time limit): the window starts the
  // next one itself. It is the same server-side session Studio shows, so the
  // browser view and every other window follow it.
  const ended = Boolean(s.session) && !s.open;
  const [starting, setStarting] = useState(false);
  async function startNext() {
    setStarting(true);
    const result = await s.actions.start(AUTO_SESSION);
    setStarting(false);
    if (!result.ok) return s.notify(failureNote(result.code));
    startedHere.current = true;
  }
  // Tell the other windows which session this one just started.
  const startedHere = useRef(false);
  const sessionId = s.session?.id ?? null;
  useEffect(() => {
    if (!sessionId || !startedHere.current) return;
    startedHere.current = false;
    openPanelBus().post({ type: "session", sessionId });
  }, [sessionId]);
  const busy =
    s.snapshot.pending.includes("pause") ||
    s.snapshot.pending.includes("resume");
  const paneButton = (
    pane: keyof typeof shown,
    icon: "forum" | "article" | "code",
    label: string,
  ) => (
    <button
      type="button"
      className="pn-bar-button"
      aria-label={`Show ${label}`}
      aria-pressed={shown[pane]}
      title={`Show or hide the ${label}`}
      onClick={() => toggle(pane)}
    >
      <Icon name={icon} />
    </button>
  );
  return (
    <>
      <PillPanel s={s}>
        {paneButton("chat", "forum", "chat")}
        {paneButton("analysis", "article", "analysis")}
        {paneButton("code", "code", "code")}
        {ended ? (
          <button
            type="button"
            className="pn-bar-button"
            aria-label="Start a new session"
            title="Start a new session"
            disabled={starting}
            onClick={() => void startNext()}
          >
            <Icon name="play_circle" filled />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="pn-bar-button"
              aria-label={s.paused ? "Resume session" : "Pause session"}
              title={s.paused ? "Resume" : "Pause"}
              disabled={busy}
              onClick={() =>
                void (s.paused ? s.actions.resume() : s.actions.pause())
              }
            >
              <Icon name={s.paused ? "play_arrow" : "pause"} filled />
            </button>
            <button
              type="button"
              className="pn-bar-button"
              aria-label="End session"
              title="End the session"
              onClick={() => setConfirming(true)}
            >
              <Icon name="stop_circle" />
            </button>
          </>
        )}
      </PillPanel>
      {ended && (
        <div className="ov-confirm pn-single-confirm" role="status">
          <span>
            This session has ended. Press <Icon name="play_circle" /> in the bar
            to start a new one.
          </span>
        </div>
      )}
      {confirming && (
        <div
          className="ov-confirm pn-single-confirm"
          role="alertdialog"
          aria-label="End this session?"
        >
          <span>
            End this session? Capture stops and running work is cancelled.
          </span>
          <button
            type="button"
            className="ov-button"
            onClick={() => setConfirming(false)}
          >
            Keep going
          </button>
          <button
            type="button"
            className="ov-button danger"
            onClick={async () => {
              const result = await s.actions.end();
              if (!result.ok) s.notify(failureNote(result.code));
              setConfirming(false);
            }}
          >
            End now
          </button>
        </div>
      )}
      <div className="pn-single-body">
        {shown.chat && (
          <div className="pn-single-pane" data-which="chat">
            <ChatPanel s={s} />
          </div>
        )}
        {shown.analysis && (
          <div className="pn-single-pane" data-which="analysis">
            <AnalysisPanel s={s} part="text" />
          </div>
        )}
        {shown.code && (
          <div className="pn-single-pane" data-which="code">
            <AnalysisPanel s={s} part="code" />
          </div>
        )}
      </div>
      <div className="pn-single-foot">
        <Footer
          controls={false}
          paused={s.paused}
          pending={s.snapshot.pending}
          actions={s.actions}
          onFailure={(code) => s.notify(failureNote(code))}
        />
      </div>
    </>
  );
}
