// The minimized view: the toolbar, the status strip, the chat, the answer and
// the code in ONE window the person can move and resize. The toolbar is the
// pivot: it stays at the centre, and showing or hiding a pane widens or narrows
// the window evenly around it. Which panes exist, how wide each is, and which
// footer buttons show are tables in toolbar-config.ts; this file only draws
// them. The footer keeps the build id and the session controls.
import type { PresentationHost } from "@omnitech/interview-contracts";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Footer, failureNote } from "../overlay-footer";
import {
  CONVERSATION_WIDTH,
  isConversation,
  useChatView,
} from "./chat-view-pref";
import { CoachNotes, coachReserve } from "./coach-notes";
import { FOCUS_INPUT_EVENT } from "./commands";
import { EndedCard } from "./ended-card";
import { InterviewContextChip } from "./interview-context-chip";
import { MiniPlayer } from "./mini-player";
import { openPanelBus } from "./panel-bus";
import type { PanelGlass } from "./panel-glass";
import { heardHistory } from "./panel-model";
import {
  AnswerPanel,
  ChatPanel,
  CodePanel,
  type PanelSession,
} from "./panel-views";
import { StatusStrip, useStrip } from "./status-strip";
import { openSessionSummary } from "./summary-link";
import { TaskBar } from "./task-bar";
import { Toolbar } from "./toolbar";
import {
  ALL_PANES_SHOWN,
  BARE_WIDTH,
  MINI_SIZE,
  PANES,
  type PaneId,
  type PaneState,
  POPOVER_ROOM,
  WINDOW_GAP,
  WINDOW_PAD,
  windowWidthFor,
} from "./toolbar-config";
import { ToolbarLock } from "./toolbar-lock";
import type { PanelWindowMode } from "./window-mode";

// Why the toolbar is locked once a session has ended.
// Set here as well as in the stylesheet, which the native window keeps until
// it reloads.
const ANSWER_SHARE = { flexGrow: 1.7 } as const;
// The conversation is read from while speaking and stands under the call
// window, so its pane is wider than the transcript's.
const CONVERSATION_SHARE = {
  flex: `0 0 ${CONVERSATION_WIDTH}px`,
} as const;
const CHAT_WIDTH = PANES.find((pane) => pane.id === "chat")?.width ?? 0;

export const ENDED_LOCK = "The session has ended. Start a new session.";

const NO_PANES: PaneState = { chat: false, analysis: false, code: false };
// The least height a window with panes showing is asked for (the shell opens at 640).
const PANE_HEIGHT = 640;

export type Panes = {
  shown: PaneState;
  toggle(pane: PaneId): void;
  show(pane: PaneId): void;
};

// Which panes of the one window are showing. All of them to begin with: the code
// opens with the answer.
export function usePanes(): Panes {
  const [shown, setShown] = useState<PaneState>(ALL_PANES_SHOWN);
  return {
    shown,
    toggle: (pane) => setShown((now) => ({ ...now, [pane]: !now[pane] })),
    show: (pane) => setShown((now) => ({ ...now, [pane]: true })),
  };
}

export function SinglePanel({
  s,
  panes,
  presentation,
  glass,
  windowMode,
}: {
  s: PanelSession;
  panes: Panes;
  presentation: PresentationHost;
  glass: PanelGlass;
  windowMode: PanelWindowMode;
}) {
  const { shown, show } = panes;
  const conversation = isConversation(useChatView());
  // Beside other panes the conversation takes its own width; alone it has the row.
  const wideChat = conversation && shown.chat && (shown.analysis || shown.code);
  // What each pane shows. The ids and sizes live in PANES.
  const view: Record<PaneId, (session: PanelSession) => ReactNode> = {
    chat: (session) => <ChatPanel s={session} />,
    analysis: (session) => <AnswerPanel s={session} />,
    code: (session) => <CodePanel s={session} />,
  };
  // The session ended (End, or the server's time limit): "Start a new session"
  // leaves its summary for the Start screen, where the interview is chosen, so
  // a session never starts without its job spec and brief attached.
  const ended = Boolean(s.session) && !s.open;
  const starting = false;
  const startedHere = useRef(false);
  function startNext() {
    s.actions.dismissFinished();
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

  // The paused wording lives in the footer's clock, so while paused the strip
  // keeps only what else it has to say; with nothing else it is not drawn.
  const strip = useStrip(s);
  const stripShown =
    strip !== null && !ended && (strip.state !== null || strip.engine);
  const [menuOpen, setMenuOpen] = useState(false);
  // A paused session shows no body: the toolbar, the strip and the footer (with
  // Resume session) stay; the panes come back on resume. An ended session shows
  // none either (owner's rule, 2026-10-08): only its toolbar (locked), the
  // "Session ended" card and the footer with Open summary and Start a new
  // session; what was said and answered is in the summary.
  const holdBody = s.paused || ended;
  const anyPane = PANES.some((pane) => shown[pane.id]) && !holdBody;

  const mode = windowMode.mode;
  // The window height the panes last had, asked back when they return.
  const paneHeight = useRef<number | null>(null);

  // The shell widens or narrows the window about its centre to fit what shows,
  // never narrower than the toolbar. With no pane showing, the window is only as
  // tall as its rows (and the room a menu needs), so the footer sits right under
  // the toolbar.
  useLayoutEffect(() => {
    // Full screen is the shell's: any size request would leave it.
    if (mode === "full") return;
    // The Mini player is a fixed card, taller while a menu hangs from it.
    if (mode === "mini") {
      void presentation.setWindowSize?.({
        width: MINI_SIZE.width,
        height: menuOpen ? MINI_SIZE.menuHeight : MINI_SIZE.height,
      });
      return;
    }
    const root = document.querySelector<HTMLElement>(".pn-root");
    // A `display: contents` wrapper (the toolbar's drag handle) has no box, so
    // nothing observes it and it measures 0: stand in its first child, the real box.
    const rows = [...(root?.children ?? [])]
      .filter(
        (row): row is HTMLElement =>
          row instanceof HTMLElement && !row.classList.contains("pn-toasts"),
      )
      .map((row) =>
        row.classList.contains("pn-contents") &&
        row.firstElementChild instanceof HTMLElement
          ? row.firstElementChild
          : row,
      );
    const fit = () => {
      const pill = root?.querySelector<HTMLElement>(".pn-toolbar");
      const toolbar =
        (pill?.offsetWidth ?? BARE_WIDTH - WINDOW_PAD) + WINDOW_PAD;
      // With the body held the window is sized for nothing but the toolbar, so the
      // strip and the footer are exactly as wide as it.
      // Plus the room a coach panel docked at the side stands in.
      const width =
        windowWidthFor(holdBody ? NO_PANES : shown, toolbar) +
        coachReserve.width +
        (wideChat && !holdBody ? CONVERSATION_WIDTH - CHAT_WIDTH : 0);
      let height: number | undefined;
      if (!anyPane && root) {
        const content =
          rows.reduce((sum, row) => sum + row.offsetHeight, 0) +
          WINDOW_GAP * Math.max(rows.length - 1, 0) +
          WINDOW_PAD;
        height = Math.max(content, menuOpen ? POPOVER_ROOM : 0);
      } else if (anyPane) {
        // Panes need room: a window left at a paused or empty height (no pane
        // showing asks for a short one) gets back the height the panes last had,
        // never less than PANE_HEIGHT. Otherwise the person's own height stands.
        const current = window.innerHeight;
        if (current >= PANE_HEIGHT) paneHeight.current = current;
        else height = Math.max(paneHeight.current ?? 0, PANE_HEIGHT);
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
    // The toolbar is observed itself: its wrapper has no box, so growing labels
    // (an account chip, a device name) would never reach the rows above.
    const pill = root?.querySelector<HTMLElement>(".pn-toolbar");
    if (pill) watch.observe(pill);
    return () => watch.disconnect();
  }, [
    shown,
    wideChat,
    holdBody,
    anyPane,
    ended,
    menuOpen,
    stripShown,
    presentation,
    mode,
  ]);

  if (mode === "mini")
    return (
      <MiniPlayer
        s={s}
        presentation={presentation}
        glass={glass}
        windowMode={windowMode}
        onMenuOpen={setMenuOpen}
      />
    );

  return (
    <>
      {/* An ended session locks the toolbar's session controls, each naming
          why (the same lock as before a session starts); the window's own
          dots stay live. */}
      <ToolbarLock.Provider value={ended ? ENDED_LOCK : null}>
        <Toolbar
          s={s}
          controls={{
            panes,
            presentation,
            glass,
            windowMode,
            onMenuOpen: setMenuOpen,
          }}
        />
      </ToolbarLock.Provider>
      {stripShown && strip && <StatusStrip s={s} strip={strip} />}
      {!holdBody && <TaskBar s={s} />}
      {anyPane && (
        <div className="pn-single-body">
          {PANES.filter((pane) => shown[pane.id]).map((pane) => (
            <div
              key={pane.id}
              className="pn-single-pane"
              data-which={pane.id}
              // The answer takes the larger share of the width beside the
              // code: it is what is read from while speaking.
              style={
                pane.id === "analysis"
                  ? ANSWER_SHARE
                  : pane.id === "chat" && wideChat
                    ? CONVERSATION_SHARE
                    : undefined
              }
            >
              {view[pane.id](s)}
            </div>
          ))}
        </div>
      )}
      {ended && <EndedCard s={s} />}
      <div className="pn-single-foot" data-drag-handle="">
        <Footer
          wording="session"
          // The interview this session is for, on show from the first second
          // (the task bar only appears with the first question).
          context={
            ended ? null : (
              <InterviewContextChip candidacyId={s.model.candidacyId} />
            )
          }
          variant={
            ended
              ? {
                  kind: "ended",
                  starting,
                  onStart: () => void startNext(),
                  ...(sessionId
                    ? { onOpenSummary: () => openSessionSummary(sessionId) }
                    : {}),
                }
              : {
                  kind: "live",
                  paused: s.paused,
                  clock: { label: s.model.elapsedLabel },
                  heard: heardHistory(s.model),
                  micLevel: s.micLevel,
                }
          }
          pending={s.snapshot.pending}
          actions={s.actions}
          onFailure={(code) => s.notify(failureNote(code))}
        />
      </div>
      {/* What a coach wants said next, and the documentation for the topic. */}
      <CoachNotes enabled={s.open} setWindowSize={presentation.setWindowSize} />
    </>
  );
}
