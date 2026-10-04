// The minimized view: the toolbar, the chat, the analysis and the code in ONE
// window the person can move and resize. The toolbar is the pivot: it stays at
// the centre, and showing or hiding a pane widens or narrows the window evenly
// around it. The toolbar carries what the card's footer did (Pause or Resume, End
// with its confirmation, a start button once the session ended); the footer keeps
// the honest "Visible window" note and the build id.
import type {
  LiveAction,
  PresentationHost,
} from "@omnitech/interview-contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../../icon";
import { failureNote, Footer } from "../overlay-footer";
import { AUTO_SESSION } from "./auto-session";
import type { CaptureMode } from "./capture-mode";
import { openPanelBus } from "./panel-bus";
import {
  AnalysisPanel,
  ChatPanel,
  type PanelSession,
  PillPanel,
} from "./panel-views";

// What each pane needs, and what the toolbar alone needs (CSS px).
export const PANE_WIDTH = { chat: 320, analysis: 480, code: 420 } as const;
// The toolbar alone, until its real width is measured.
export const BARE_WIDTH = 540;
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

const RUNTIME_LABEL: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
};

// "Claude · claude-sonnet-5-5": what produced the latest answer, or null before
// the first one. Display only; nothing depends on it.
export function generatedByLabel(
  actions: readonly LiveAction[],
): string | null {
  const latest = actions
    .filter(
      (action) => action.generatedBy && action.dispatchStatus === "succeeded",
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const by = latest?.generatedBy;
  return by ? `${RUNTIME_LABEL[by.runtime] ?? by.runtime} · ${by.model}` : null;
}

export type Panes = {
  shown: { chat: boolean; analysis: boolean; code: boolean };
  toggle(pane: "chat" | "analysis" | "code"): void;
};

// Which panes of the one window are showing. The code opens with the analysis:
// expanded by default.
export function usePanes(): Panes {
  const [shown, setShown] = useState({
    chat: true,
    analysis: true,
    code: true,
  });
  return {
    shown,
    toggle: (pane) => setShown((now) => ({ ...now, [pane]: !now[pane] })),
  };
}

export function SinglePanel({
  s,
  panes: { shown, toggle },
  presentation,
  captureMode,
}: {
  s: PanelSession;
  panes: Panes;
  presentation: PresentationHost;
  captureMode: { value: CaptureMode; onChange(mode: CaptureMode): void };
}) {
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
  const model = generatedByLabel(s.snapshot.actions);
  // The shell widens or narrows the window about its centre to fit what shows,
  // never narrower than the toolbar. With no pane showing, the window is only as
  // tall as the toolbar and footer, so the footer sits right under the toolbar.
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(".pn-root");
    const bare = !shown.chat && !shown.analysis && !shown.code;
    const fit = () => {
      const pill = root?.querySelector<HTMLElement>(".pn-pill");
      const toolbar = (pill?.offsetWidth ?? BARE_WIDTH - PAD) + PAD;
      const width = Math.max(windowWidthFor(shown), toolbar);
      let height: number | undefined;
      if (bare && root) {
        const rows = [...root.children].filter(
          (row): row is HTMLElement =>
            row instanceof HTMLElement && !row.classList.contains("pn-toasts"),
        );
        height =
          rows.reduce((sum, row) => sum + row.offsetHeight, 0) +
          GAP * Math.max(rows.length - 1, 0) +
          PAD;
      }
      void presentation.setWindowSize?.({
        width,
        ...(height === undefined ? {} : { height }),
      });
    };
    fit();
    // With nothing showing the window is only as tall as its rows, so it follows
    // the footer as its confirmation opens and closes.
    const foot = root?.querySelector<HTMLElement>(".pn-single-foot");
    if (!bare || !foot || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(fit);
    watch.observe(foot);
    return () => watch.disconnect();
  }, [shown, ended, model, presentation]);
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
      <PillPanel s={s} captureMode={captureMode}>
        {model && (
          <span
            className="pn-model"
            title={`Generated by ${model}`}
            data-testid="pn-model"
          >
            {model}
          </span>
        )}
        {paneButton("chat", "forum", "chat")}
        {paneButton("analysis", "article", "analysis")}
        {paneButton("code", "code", "code")}
      </PillPanel>
      {(shown.chat || shown.analysis || shown.code) && (
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
      )}
      <div className="pn-single-foot">
        <Footer
          endLabel="End session"
          ended={ended}
          onStart={() => void startNext()}
          starting={starting}
          paused={s.paused}
          pending={s.snapshot.pending}
          actions={s.actions}
          onFailure={(code) => s.notify(failureNote(code))}
        />
      </div>
    </>
  );
}
