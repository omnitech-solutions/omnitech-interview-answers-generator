// The minimized view: the toolbar, the chat and the analysis in ONE window the
// person can move and resize. The toolbar carries what the card's footer did:
// show or hide each pane, Pause or Resume, and End (with its confirmation). The
// footer keeps the honest "Visible window" note and the build id. The shell's
// right-edge handle grows the window to the right; the analysis follows its width.
import { useEffect, useState } from "react";
import { Icon } from "../../../icon";
import { failureNote, Footer } from "../overlay-footer";
import {
  AnalysisPanel,
  ChatPanel,
  type PanelSession,
  PillPanel,
} from "./panel-views";

// Wide enough to hold the chat and the analysis side by side.
export const WIDE_AT = 640;
const wide = (): boolean => window.innerWidth >= WIDE_AT;

export function SinglePanel({ s }: { s: PanelSession }) {
  const [showChat, setShowChat] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(wide);
  const [confirming, setConfirming] = useState(false);
  // Growing or shrinking the window opens or folds the analysis with it.
  useEffect(() => {
    const onResize = () => setShowAnalysis(wide());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const busy =
    s.snapshot.pending.includes("pause") ||
    s.snapshot.pending.includes("resume");
  return (
    <>
      <PillPanel s={s}>
        <button
          type="button"
          className="pn-bar-button"
          aria-label="Show chat"
          aria-pressed={showChat}
          title="Show or hide the chat"
          onClick={() => setShowChat((on) => !on)}
        >
          <Icon name="forum" />
        </button>
        <button
          type="button"
          className="pn-bar-button"
          aria-label="Show analysis"
          aria-pressed={showAnalysis}
          title="Show or hide the analysis"
          onClick={() => setShowAnalysis((on) => !on)}
        >
          <Icon name="article" />
        </button>
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
          className="pn-bar-button pn-end"
          aria-label="End session"
          title="End the session"
          onClick={() => setConfirming(true)}
        >
          <Icon name="stop_circle" />
        </button>
      </PillPanel>
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
        {showChat && (
          <div className="pn-single-pane" data-which="chat">
            <ChatPanel s={s} />
          </div>
        )}
        {showAnalysis && (
          <div className="pn-single-pane" data-which="analysis">
            <AnalysisPanel s={s} />
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
