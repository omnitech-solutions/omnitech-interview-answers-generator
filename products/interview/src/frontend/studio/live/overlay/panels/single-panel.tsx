// The minimized view: the toolbar, the chat, the analysis and the code in ONE
// window the person can move and resize. The toolbar is the pivot: it stays at
// the centre, and showing or hiding a pane widens or narrows the window evenly
// around it. Which panes exist, how wide each is, and which footer buttons show
// are tables in toolbar-config.ts; this file only draws them. The footer keeps
// the honest "Visible window" note and the build id.
import type {
  LiveAction,
  PresentationHost,
} from "@omnitech/interview-contracts";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  useElapsed,
} from "./panel-views";
import {
  ALL_PANES_SHOWN,
  BARE_WIDTH,
  PANES,
  type PaneId,
  phaseLabel,
  type PaneState,
  WINDOW_GAP,
  WINDOW_PAD,
  windowWidthFor,
} from "./toolbar-config";

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

// What each pane shows. The ids and sizes live in PANES.
const PANE_VIEW: Record<PaneId, (s: PanelSession) => ReactNode> = {
  chat: (s) => <ChatPanel s={s} />,
  analysis: (s) => <AnalysisPanel s={s} part="text" />,
  code: (s) => <AnalysisPanel s={s} part="code" />,
};

export type Panes = {
  shown: PaneState;
  toggle(pane: PaneId): void;
};

// Which panes of the one window are showing. All of them to begin with: the code
// opens with the analysis.
export function usePanes(): Panes {
  const [shown, setShown] = useState<PaneState>(ALL_PANES_SHOWN);
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
  const startedHere = useRef(false);
  async function startNext() {
    setStarting(true);
    const result = await s.actions.start(AUTO_SESSION);
    setStarting(false);
    if (!result.ok) return s.notify(failureNote(result.code));
    startedHere.current = true;
  }
  // Tell the other windows which session this one just started.
  const sessionId = s.session?.id ?? null;
  useEffect(() => {
    if (!sessionId || !startedHere.current) return;
    startedHere.current = false;
    openPanelBus().post({ type: "session", sessionId });
  }, [sessionId]);

  const model = generatedByLabel(s.snapshot.actions);
  const doing = phaseLabel(s.phase, s.model.activity.key);
  const waited = useElapsed(doing !== null);
  const anyPane = PANES.some((pane) => shown[pane.id]);

  // The shell widens or narrows the window about its centre to fit what shows,
  // never narrower than the toolbar. With no pane showing, the window is only as
  // tall as its rows, so the footer sits right under the toolbar.
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(".pn-root");
    const fit = () => {
      const pill = root?.querySelector<HTMLElement>(".pn-pill");
      const toolbar =
        (pill?.offsetWidth ?? BARE_WIDTH - WINDOW_PAD) + WINDOW_PAD;
      const width = windowWidthFor(shown, toolbar);
      let height: number | undefined;
      if (!anyPane && root) {
        const rows = [...root.children].filter(
          (row): row is HTMLElement =>
            row instanceof HTMLElement && !row.classList.contains("pn-toasts"),
        );
        height =
          rows.reduce((sum, row) => sum + row.offsetHeight, 0) +
          WINDOW_GAP * Math.max(rows.length - 1, 0) +
          WINDOW_PAD;
      }
      void presentation.setWindowSize?.({
        width,
        ...(height === undefined ? {} : { height }),
      });
    };
    fit();
    // With nothing showing the window follows the footer as its confirmation
    // opens and closes.
    const foot = root?.querySelector<HTMLElement>(".pn-single-foot");
    if (anyPane || !foot || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(fit);
    watch.observe(foot);
    return () => watch.disconnect();
  }, [shown, anyPane, ended, model, presentation]);

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
        {PANES.map((pane) => (
          <button
            key={pane.id}
            type="button"
            className="pn-bar-button"
            aria-label={`Show ${pane.label}`}
            aria-pressed={shown[pane.id]}
            title={`Show or hide the ${pane.label}`}
            onClick={() => toggle(pane.id)}
          >
            <Icon name={pane.icon} />
          </button>
        ))}
      </PillPanel>
      {anyPane && (
        <div className="pn-single-body">
          {PANES.filter((pane) => shown[pane.id]).map((pane) => (
            <div key={pane.id} className="pn-single-pane" data-which={pane.id}>
              {PANE_VIEW[pane.id](s)}
            </div>
          ))}
        </div>
      )}
      <div className="pn-single-foot">
        {doing && (
          <p className="pn-status" role="status" data-testid="pn-status">
            <span className="pn-ellipsis" aria-hidden="true">
              <i />
              <i />
            </span>
            {doing}
            {waited >= 3 && ` · ${waited}s`}
            {model && <span className="pn-muted"> · {model}</span>}
          </p>
        )}
        <Footer
          sessionWording
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
