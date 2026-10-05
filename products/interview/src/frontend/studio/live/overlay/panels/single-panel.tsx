// The minimized view: the toolbar, the status strip, the chat, the answer and
// the code in ONE window the person can move and resize. The toolbar is the
// pivot: it stays at the centre, and showing or hiding a pane widens or narrows
// the window evenly around it. Which panes exist, how wide each is, and which
// footer buttons show are tables in toolbar-config.ts; this file only draws
// them. The footer keeps the honest "Visible window" note and the build id.
import type { PresentationHost } from "@omnitech/interview-contracts";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Footer, failureNote } from "../overlay-footer";
import { AUTO_SESSION } from "./auto-session";
import type { CaptureMode } from "./capture-mode";
import { FOCUS_INPUT_EVENT } from "./commands";
import { EndedCard } from "./ended-card";
import { openPanelBus } from "./panel-bus";
import { AnalysisPanel, ChatPanel, type PanelSession } from "./panel-views";
import { StatusStrip, useStrip } from "./status-strip";
import { openSessionSummary } from "./summary-link";
import { Toolbar } from "./toolbar";
import {
  ALL_PANES_SHOWN,
  BARE_WIDTH,
  nativeChord,
  PANES,
  type PaneId,
  type PaneState,
  POPOVER_ROOM,
  WINDOW_GAP,
  WINDOW_PAD,
  windowWidthFor,
} from "./toolbar-config";

export type Panes = {
  shown: PaneState;
  toggle(pane: PaneId): void;
  show(pane: PaneId): void;
  // Every pane at once: the window controls' collapse (none) and expand (all).
  setAll(shown: boolean): void;
};

// Which panes of the one window are showing. All of them to begin with: the code
// opens with the answer.
export function usePanes(): Panes {
  const [shown, setShown] = useState<PaneState>(ALL_PANES_SHOWN);
  return {
    shown,
    toggle: (pane) => setShown((now) => ({ ...now, [pane]: !now[pane] })),
    show: (pane) => setShown((now) => ({ ...now, [pane]: true })),
    setAll: (all) =>
      setShown(
        Object.fromEntries(PANES.map((pane) => [pane.id, all])) as PaneState,
      ),
  };
}

export function SinglePanel({
  s,
  panes,
  presentation,
  captureMode,
}: {
  s: PanelSession;
  panes: Panes;
  presentation: PresentationHost;
  captureMode: { value: CaptureMode; onChange(mode: CaptureMode): void };
}) {
  const { shown, show } = panes;
  // What each pane shows. The ids and sizes live in PANES.
  const view: Record<PaneId, (session: PanelSession) => ReactNode> = {
    chat: (session) => <ChatPanel s={session} />,
    analysis: (session) => (
      <AnalysisPanel
        s={session}
        part="text"
        autoWatching={captureMode.value === "auto"}
      />
    ),
    code: (session) => <AnalysisPanel s={session} part="code" />,
  };
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
  // Tell the other windows (Settings) which session this one just started.
  const sessionId = s.session?.id ?? null;
  useEffect(() => {
    if (!sessionId || !startedHere.current) return;
    startedHere.current = false;
    openPanelBus().post({ type: "session", sessionId });
  }, [sessionId]);

  // The chat takes focus on its command, opening first when it is hidden: the
  // focus is asked for once it is on screen (its own listener is in by then).
  const chatShown = shown.chat;
  const focusWhenShown = useRef(false);
  useEffect(() => {
    if (chatShown) {
      if (!focusWhenShown.current) return;
      focusWhenShown.current = false;
      window.dispatchEvent(new Event(FOCUS_INPUT_EVENT));
      return;
    }
    const open = () => {
      focusWhenShown.current = true;
      show("chat");
    };
    window.addEventListener(FOCUS_INPUT_EVENT, open);
    return () => window.removeEventListener(FOCUS_INPUT_EVENT, open);
  }, [chatShown, show]);

  const strip = useStrip(s);
  const stripShown = strip !== null && !ended;
  const [menuOpen, setMenuOpen] = useState(false);
  const anyPane = PANES.some((pane) => shown[pane.id]);
  const clickThrough = s.interaction === false;

  // The shell widens or narrows the window about its centre to fit what shows,
  // never narrower than the toolbar. With no pane showing, the window is only as
  // tall as its rows (and the room a menu needs), so the footer sits right under
  // the toolbar.
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(".pn-root");
    const rows = [...(root?.children ?? [])].filter(
      (row): row is HTMLElement =>
        row instanceof HTMLElement &&
        !row.classList.contains("pn-toasts") &&
        !row.classList.contains("pn-clickthrough"),
    );
    const fit = () => {
      const pill = root?.querySelector<HTMLElement>(".pn-pill");
      const toolbar =
        (pill?.offsetWidth ?? BARE_WIDTH - WINDOW_PAD) + WINDOW_PAD;
      const width = windowWidthFor(shown, toolbar);
      let height: number | undefined;
      if (!anyPane && root) {
        const content =
          rows.reduce((sum, row) => sum + row.offsetHeight, 0) +
          WINDOW_GAP * Math.max(rows.length - 1, 0) +
          WINDOW_PAD;
        height = Math.max(content, menuOpen ? POPOVER_ROOM : 0);
      }
      void presentation.setWindowSize?.({
        width,
        ...(height === undefined ? {} : { height }),
      });
    };
    fit();
    // The toolbar grows with its labels and the rows with their content; the
    // window follows both.
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(fit);
    for (const row of rows) watch.observe(row);
    return () => watch.disconnect();
  }, [shown, anyPane, ended, menuOpen, stripShown, presentation]);

  return (
    <>
      <Toolbar
        s={s}
        controls={{ panes, presentation, captureMode, onMenuOpen: setMenuOpen }}
      />
      {stripShown && strip && <StatusStrip s={s} strip={strip} />}
      {anyPane && (
        <div className="pn-single-body">
          {PANES.filter((pane) => shown[pane.id]).map((pane) => (
            <div key={pane.id} className="pn-single-pane" data-which={pane.id}>
              {view[pane.id](s)}
            </div>
          ))}
        </div>
      )}
      {ended && <EndedCard s={s} />}
      <div className="pn-single-foot">
        <Footer
          sessionWording
          ended={ended}
          onStart={() => void startNext()}
          {...(sessionId
            ? { onOpenSummary: () => openSessionSummary(sessionId) }
            : {})}
          starting={starting}
          clock={
            ended ? null : { label: s.model.elapsedLabel, paused: s.paused }
          }
          paused={s.paused}
          pending={s.snapshot.pending}
          actions={s.actions}
          onFailure={(code) => s.notify(failureNote(code))}
        />
      </div>
      {clickThrough && (
        <p
          className="pn-clickthrough"
          role="status"
          data-testid="pn-clickthrough"
        >
          Click-through is on. Clicks reach the page underneath. Press{" "}
          {nativeChord("click-through")} to interact.
        </p>
      )}
    </>
  );
}
