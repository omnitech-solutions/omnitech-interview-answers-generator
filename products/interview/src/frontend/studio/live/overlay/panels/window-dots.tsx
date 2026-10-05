// The window's own controls, drawn from WINDOW_CONTROLS: red quits (after a
// confirmation), yellow hides the window (pausing a live session first so
// nothing keeps capturing out of sight), green toggles full screen and, when
// the pointer rests on it, opens the window-size menu (WINDOW_MODES).
//
// [SAFETY] Hiding never leaves capture or listening running: a session that is
// live is paused before the window goes, and says so.
import type { PresentationHost } from "@omnitech/interview-contracts";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { failureNote } from "../overlay-footer";
import { useDismiss } from "../use-dismiss";
import type { PanelSession } from "./panel-views";
import { hasCapability } from "./presentation-host";
import {
  GREEN_MENU_GRACE_MS,
  GREEN_MENU_HOVER_MS,
  QUIT_CONFIRMATION,
  WINDOW_CONTROLS,
  WINDOW_MODES,
  type WindowControlAction,
} from "./toolbar-config";
import { TOAST_TEXT } from "./use-panel-session";
import { modeAvailable, type PanelWindowMode } from "./window-mode";

type Popup = "quit" | "size" | null;
const ITEM = '[role^="menuitem"]:not([aria-disabled="true"])';

export function WindowDots({
  s,
  presentation,
  windowMode,
  onPopup,
}: {
  s: PanelSession;
  presentation: PresentationHost;
  windowMode: PanelWindowMode;
  // A popup is open: the window keeps room below the bar for it.
  onPopup(open: boolean): void;
}) {
  const [popup, setPopup] = useState<Popup>(null);
  useEffect(() => onPopup(popup !== null), [popup, onPopup]);
  const recoverable = hasCapability(presentation, "always-on-top");
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopTimers = () => {
    clearTimeout(hover.current);
    clearTimeout(grace.current);
    hover.current = undefined;
    grace.current = undefined;
  };
  useEffect(() => stopTimers, []);
  // What the dot that opened a popup gets back when it closes.
  const dots = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusOnOpen = useRef(false);

  async function hide() {
    // A live session pauses first; if that fails the window stays, with the reason.
    if (s.open && !s.paused) {
      const result = await s.actions.pause();
      if (!result.ok) return s.notify(failureNote(result.code, result.reason));
      s.toast(TOAST_TEXT.hiddenPaused());
    }
    void presentation.setVisible(false);
  }
  const quittable = typeof presentation.quit === "function";
  const sizable = modeAvailable(presentation, "full");
  const unavailable: Record<WindowControlAction, string | null> = {
    quit: quittable ? null : "Only the Mac app can quit from here",
    hide: recoverable
      ? null
      : "Only the Mac app can hide its window and bring it back",
    size: sizable ? null : "Only the Mac app can change its window size",
  };
  const run: Record<WindowControlAction, () => void> = {
    quit: () => setPopup(popup === "quit" ? null : "quit"),
    hide: () => void hide(),
    size: () => {
      stopTimers();
      setPopup(null);
      windowMode.toggleFullScreen();
    },
  };

  const closeTo = (id: string) => {
    setPopup(null);
    dots.current[id]?.focus();
  };
  // Escape closes the open popup and gives the focus back to its dot.
  const onKeyDown =
    (id: string, which: Exclude<Popup, null>) => (event: KeyboardEvent) => {
      if (event.key !== "Escape" || popup !== which) return;
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      closeTo(id);
    };

  // The green dot: hover opens the menu after a pause; the pointer may cross the
  // gap to the menu, which closes shortly after it leaves both.
  const enter = () => {
    clearTimeout(grace.current);
    if (popup === "size" || hover.current !== undefined) return;
    hover.current = setTimeout(() => {
      hover.current = undefined;
      setPopup("size");
    }, GREEN_MENU_HOVER_MS);
  };
  const leave = () => {
    clearTimeout(hover.current);
    hover.current = undefined;
    if (popup === "size")
      grace.current = setTimeout(() => setPopup(null), GREEN_MENU_GRACE_MS);
  };
  // Keyboard and touch cannot hover: ArrowDown and the context menu open it.
  const openSize = () => {
    stopTimers();
    focusOnOpen.current = true;
    setPopup("size");
  };

  const render = (control: (typeof WINDOW_CONTROLS)[number]): ReactNode => {
    const reason = unavailable[control.action];
    const dot = (
      <button
        key={control.id}
        ref={(node) => {
          dots.current[control.id] = node;
        }}
        type="button"
        className="pn-window-dot"
        data-colour={control.colour}
        data-testid={`pn-dot-${control.id}`}
        aria-label={control.label}
        title={reason ?? control.title}
        disabled={reason !== null}
        aria-haspopup={
          control.action === "hide"
            ? undefined
            : control.action === "quit"
              ? "dialog"
              : "menu"
        }
        aria-expanded={
          control.action === "hide"
            ? undefined
            : popup === (control.action === "quit" ? "quit" : "size")
        }
        onClick={() => run[control.action]()}
        onKeyDown={
          control.action === "size"
            ? (event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  openSize();
                }
              }
            : undefined
        }
        onContextMenu={
          control.action === "size"
            ? (event) => {
                event.preventDefault();
                openSize();
              }
            : undefined
        }
      >
        <span aria-hidden="true">{control.glyph}</span>
      </button>
    );
    if (control.action === "hide") return dot;
    if (control.action === "quit")
      return (
        <QuitPopover
          key={control.id}
          open={popup === "quit"}
          dot={dot}
          onClose={() => closeTo(control.id)}
          onDismiss={() => setPopup(null)}
          onKeyDown={onKeyDown(control.id, "quit")}
          onQuit={() => {
            setPopup(null);
            void presentation.quit?.();
          }}
        />
      );
    return (
      <SizeMenu
        key={control.id}
        open={popup === "size"}
        dot={dot}
        windowMode={windowMode}
        presentation={presentation}
        focusFirst={focusOnOpen}
        onEnter={enter}
        onLeave={leave}
        onDismiss={() => setPopup(null)}
        onKeyDown={onKeyDown(control.id, "size")}
        onChoose={(id) => {
          setPopup(null);
          windowMode.set(id);
          dots.current[control.id]?.focus();
        }}
      />
    );
  };

  return (
    <div className="pn-dots" role="group" aria-label="Window controls">
      {WINDOW_CONTROLS.map(render)}
    </div>
  );
}

// "Quit Interview Studio?" under the red dot. Focus starts on Cancel.
function QuitPopover({
  open,
  dot,
  onClose,
  onDismiss,
  onKeyDown,
  onQuit,
}: {
  open: boolean;
  dot: ReactNode;
  onClose(): void;
  onDismiss(): void;
  onKeyDown(event: KeyboardEvent): void;
  onQuit(): void;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDismiss(root, open, onDismiss);
  useEffect(() => {
    if (open) cancel.current?.focus();
  }, [open]);
  return (
    <span className="pn-popover" ref={root} onKeyDown={onKeyDown}>
      {dot}
      {open && (
        <div
          id={id}
          className="pn-menu pn-menu-narrow pn-quit"
          role="alertdialog"
          aria-label={QUIT_CONFIRMATION.question}
          data-testid="pn-quit-confirm"
        >
          <strong>{QUIT_CONFIRMATION.question}</strong>
          <span className="pn-menu-sub">{QUIT_CONFIRMATION.detail}</span>
          <span className="pn-quit-buttons">
            <button
              ref={cancel}
              type="button"
              className="pn-mini-button"
              onClick={onClose}
            >
              {QUIT_CONFIRMATION.cancel}
            </button>
            <button
              type="button"
              className="pn-mini-button pn-quit-confirm"
              onClick={onQuit}
            >
              {QUIT_CONFIRMATION.confirm}
            </button>
          </span>
        </div>
      )}
    </span>
  );
}

// The window-size menu under the green dot.
function SizeMenu({
  open,
  dot,
  windowMode,
  presentation,
  focusFirst,
  onEnter,
  onLeave,
  onDismiss,
  onKeyDown,
  onChoose,
}: {
  open: boolean;
  dot: ReactNode;
  windowMode: PanelWindowMode;
  presentation: PresentationHost;
  focusFirst: { current: boolean };
  onEnter(): void;
  onLeave(): void;
  onDismiss(): void;
  onKeyDown(event: KeyboardEvent): void;
  onChoose(id: (typeof WINDOW_MODES)[number]["id"]): void;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(root, open, onDismiss);
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>(ITEM) ?? []),
  ];
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    (
      menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      items()[0]
    )?.focus();
  }, [open, focusFirst]);
  // Arrow keys move through the items; from the dot, ArrowDown enters the menu.
  const onMenuKey = (event: KeyboardEvent) => {
    onKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === "Tab") return onDismiss();
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const all = items();
    if (step === 0 || all.length === 0) return;
    event.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[(at + step + all.length) % all.length]?.focus();
  };
  return (
    <span
      className="pn-popover"
      ref={root}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={(event) => {
        // ArrowDown on the dot of an open menu moves into it.
        if (
          open &&
          event.key === "ArrowDown" &&
          !menu.current?.contains(event.target as Node)
        ) {
          event.preventDefault();
          items()[0]?.focus();
          return;
        }
        if (menu.current?.contains(event.target as Node)) onMenuKey(event);
        else onKeyDown(event);
      }}
    >
      {dot}
      {open && (
        <div
          ref={menu}
          className="pn-menu pn-menu-narrow"
          role="menu"
          aria-label="Window size"
          tabIndex={-1}
        >
          {WINDOW_MODES.map((mode) => {
            const available = modeAvailable(presentation, mode.id);
            const checked = mode.id === windowMode.mode;
            return (
              <button
                key={mode.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                aria-disabled={!available}
                className="pn-menu-item"
                data-testid={`pn-size-${mode.id}`}
                onClick={() => {
                  if (!available) return;
                  onChoose(mode.id);
                }}
              >
                <Icon name="check" style={{ opacity: checked ? 1 : 0 }} />
                <span>
                  <span className="pn-menu-label">{mode.label}</span>
                  <span className="pn-menu-sub">{mode.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
