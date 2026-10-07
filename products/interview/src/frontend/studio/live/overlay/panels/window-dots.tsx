// The window's own controls, drawn from WINDOW_CONTROLS (the dots are library
// IconButtons in the macOS colours, the size menu is the library ActionMenu and
// the quit confirmation the library Popover): red quits (after a
// confirmation), yellow hides the window (pausing a live session first so
// nothing keeps capturing out of sight), green toggles full screen and, when
// the pointer rests on it, opens the window-size menu (WINDOW_MODES).
//
// [SAFETY] Hiding never leaves capture or listening running: a session that is
// live is paused before the window goes, and says so.

import {
  ActionMenu,
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@oc-tech/omni-ui-components";
import type { PresentationHost } from "@omnitech/interview-contracts";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { failureNote } from "../overlay-footer";
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
const SIZE_MENU = "Window size";

export function WindowDots({
  s,
  presentation,
  windowMode,
  container = null,
  onPopup,
}: {
  s: PanelSession;
  presentation: PresentationHost;
  windowMode: PanelWindowMode;
  // Where the popups are drawn: the window's own root (the body without one).
  container?: HTMLElement | null;
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
    setPopup("size");
  };

  const render = (control: (typeof WINDOW_CONTROLS)[number]): ReactNode => {
    const reason = unavailable[control.action];
    const dot = (
      <IconButton
        key={control.id}
        ref={(node) => {
          dots.current[control.id] = node;
        }}
        variant="ghost"
        iconSize="sm"
        className="pn-window-dot"
        data-colour={control.colour}
        data-testid={`pn-dot-${control.id}`}
        label={control.label}
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
        icon={<span aria-hidden="true">{control.glyph}</span>}
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
      />
    );
    if (control.action === "hide") return dot;
    if (control.action === "quit")
      return (
        <QuitPopover
          key={control.id}
          open={popup === "quit"}
          dot={dot}
          container={container}
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
        container={container}
        windowMode={windowMode}
        presentation={presentation}
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

// "Quit Interview Studio?" under the red dot. Focus starts on Cancel (the first
// button of the popover).
function QuitPopover({
  open,
  dot,
  container,
  onClose,
  onDismiss,
  onKeyDown,
  onQuit,
}: {
  open: boolean;
  dot: ReactNode;
  container: HTMLElement | null;
  onClose(): void;
  onDismiss(): void;
  onKeyDown(event: KeyboardEvent): void;
  onQuit(): void;
}) {
  return (
    <span className="pn-popover" onKeyDown={onKeyDown}>
      {/* The dot's own click opens and closes it; the popover only reports a
          dismissal (Escape, a press outside). */}
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) onDismiss();
        }}
      >
        <PopoverTrigger asChild>{dot}</PopoverTrigger>
        <PopoverContent
          role="alertdialog"
          aria-label={QUIT_CONFIRMATION.question}
          data-testid="pn-quit-confirm"
          container={container}
          align="start"
          className="pn-quit"
        >
          <strong>{QUIT_CONFIRMATION.question}</strong>
          <span className="pn-quit-detail">{QUIT_CONFIRMATION.detail}</span>
          <span className="pn-quit-buttons">
            <Button buttonSize="control" variant="outline" onClick={onClose}>
              {QUIT_CONFIRMATION.cancel}
            </Button>
            <Button buttonSize="control" tone="danger" onClick={onQuit}>
              {QUIT_CONFIRMATION.confirm}
            </Button>
          </span>
        </PopoverContent>
      </Popover>
    </span>
  );
}

// The window-size menu under the green dot: opened by the pointer resting on the
// dot (the timers are the dots'), by ArrowDown or by the context menu; the
// library menu does the arrow keys, Escape and the focus.
function SizeMenu({
  open,
  dot,
  container,
  windowMode,
  presentation,
  onEnter,
  onLeave,
  onDismiss,
  onKeyDown,
  onChoose,
}: {
  open: boolean;
  dot: ReactNode;
  container: HTMLElement | null;
  windowMode: PanelWindowMode;
  presentation: PresentationHost;
  onEnter(): void;
  onLeave(): void;
  onDismiss(): void;
  onKeyDown(event: KeyboardEvent): void;
  onChoose(id: (typeof WINDOW_MODES)[number]["id"]): void;
}) {
  const items = () => [
    ...document.querySelectorAll<HTMLElement>(
      `[data-slot="action-menu"][aria-label="${SIZE_MENU}"] ${ITEM}`,
    ),
  ];
  return (
    <span
      className="pn-popover"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={(event) => {
        // ArrowDown on the dot of an open menu moves into it.
        if (open && event.key === "ArrowDown" && items().length > 0) {
          if (!items().includes(event.target as HTMLElement)) {
            event.preventDefault();
            items()[0]?.focus();
            return;
          }
        }
        onKeyDown(event);
      }}
    >
      <ActionMenu
        label={SIZE_MENU}
        width={260}
        container={container}
        open={open}
        // The dot opens it (hover, ArrowDown, the context menu); the menu only
        // reports being dismissed.
        onOpenChange={(next) => {
          if (!next) onDismiss();
        }}
        sections={[
          {
            id: "sizes",
            selection: "single",
            items: WINDOW_MODES.map((mode) => ({
              id: mode.id,
              label: mode.label,
              description: mode.hint,
              checked: mode.id === windowMode.mode,
              disabled: !modeAvailable(presentation, mode.id),
            })),
          },
        ]}
        onSelect={(id) => onChoose(id as (typeof WINDOW_MODES)[number]["id"])}
        trigger={dot as ReactElement}
      />
    </span>
  );
}
