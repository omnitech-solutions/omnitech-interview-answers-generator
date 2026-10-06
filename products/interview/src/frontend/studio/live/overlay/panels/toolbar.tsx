// The toolbar, drawn from the tables in toolbar-config.ts: the capture control
// (capture button with its screen-target chevron, and the mode menu), the
// microphone, the answer style, the model chip, the pane toggles, See-through and
// the shortcut list. It holds no session logic: every control calls the one
// panel session.
//
// [SAFETY] Nothing here conceals capture; See-through only lets the mouse reach
// the page underneath over empty glass, and the window stays visible.
import type { PresentationHost } from "@omnitech/interview-contracts";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { displaySelectionAvailable } from "../../host-adapter";
import { useCaptureSource } from "../../host-display";
import { nativeChord, shortcutsFor } from "../../shared/shortcuts";
import { SKILLS } from "../../shared/skills";
import { DEFAULT_SKILL } from "./commands";
import { captureButtonTitle } from "./display-picker-model";
import { canPassThrough } from "./hit-regions";
import type { PanelGlass } from "./panel-glass";
import type { PanelSession } from "./panel-views";
import { Popover } from "./popover";
import { ScreenPicker } from "./screen-picker";
import type { Panes } from "./single-panel";
import {
  captureControl,
  captureMenuItems,
  captureModeOf,
  PANES,
  SEE_THROUGH_CONTROL,
  seeThroughTitle,
} from "./toolbar-config";
import { ToolbarLock, useToolbarLock } from "./toolbar-lock";
import { MIC_HELD_TEXT } from "./use-engine";
import { WindowDots } from "./window-dots";
import type { PanelWindowMode } from "./window-mode";

type Tone = "green" | "red" | "neutral";

// green: the window takes clicks. red: recording.
function pillTone(
  s: PanelSession,
  locked = false,
): { tone: Tone; label: string } {
  // Before a session runs nothing has ended: it has not started.
  if (locked) return { tone: "neutral", label: "No live session" };
  if (!s.open) return { tone: "neutral", label: "Ended" };
  if (s.live.mic === "listening") return { tone: "red", label: "Recording" };
  return { tone: "green", label: "Live" };
}

type MenuId = "mode" | "skill" | "screen" | "keys";

// What the one window gives the toolbar.
type WindowControls = {
  panes: Panes;
  presentation: PresentationHost;
  glass: PanelGlass;
  windowMode: PanelWindowMode;
  // A menu is open: the window keeps room below the bar for it.
  onMenuOpen(open: boolean): void;
};

// The capture button: capture, or Stop while work runs, with the status dot.
// The Mini player draws the same one. Where the host can choose a screen, its
// tooltip also names the target, and a right-click or ArrowDown opens the
// screen-target menu (`onOpenTargets`), as the chevron beside it does.
export function CaptureButton({
  s,
  onOpenTargets,
  menuOpen,
  buttonRef,
}: {
  s: PanelSession;
  onOpenTargets?: () => void;
  // The screen menu is open (the button names the menu it opens).
  menuOpen?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const lock = useToolbarLock();
  const status = pillTone(s, lock !== null);
  const control = captureControl(Boolean(s.phase));
  const source = useCaptureSource();
  const chord = nativeChord("analyze");
  const title =
    displaySelectionAvailable() && !control.stop
      ? captureButtonTitle(control.title, source, chord)
      : `${control.title} · ${chord}`;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`pn-split-main${onOpenTargets ? " pn-joined" : ""}`}
        aria-label={control.label}
        {...(onOpenTargets
          ? {
              "aria-haspopup": "menu" as const,
              "aria-expanded": menuOpen === true,
            }
          : {})}
        title={lock ?? title}
        disabled={lock !== null || !s.open || s.phase === "capturing"}
        onClick={() => s.press("capture")}
        {...(onOpenTargets
          ? {
              onContextMenu: (event: MouseEvent) => {
                event.preventDefault();
                onOpenTargets();
              },
              onKeyDown: (event: KeyboardEvent) => {
                if (event.key !== "ArrowDown") return;
                event.preventDefault();
                onOpenTargets();
              },
            }
          : {})}
      >
        <span className="pn-icon-dot">
          <Icon
            name={control.stop ? "stop_circle" : "screenshot_monitor"}
            filled
          />
          <span
            className="pn-dot"
            data-tone={status.tone}
            title={status.label}
            aria-hidden="true"
            data-testid="pn-dot"
          />
        </span>
      </button>
      {/* The state the dot colours, outside the button so the button's name
          stays its action. */}
      <span className="pn-sr" role="status" data-testid="pn-status">
        {status.label}
      </span>
    </>
  );
}

export function MicButton({ s }: { s: PanelSession }) {
  const recording = s.live.mic === "listening";
  // ONE predicate (the engine's micAction) decides the label and the press: a
  // held session shows the control disabled with the reason, never a label
  // the press would contradict.
  const held = s.micHeld;
  const lock = useToolbarLock();
  const name = recording ? "Stop microphone" : "Start microphone";
  return (
    <button
      type="button"
      className="pn-bar-button pn-icon-button pn-mic-button"
      aria-label={name}
      title={
        lock ??
        (held
          ? `${name} · ${MIC_HELD_TEXT.replace(/\.$/, "")}`
          : `${name} · ${nativeChord("listening")}`)
      }
      aria-pressed={recording}
      data-mic={s.live.mic}
      data-held={held ? "true" : undefined}
      disabled={lock !== null || !s.open || held}
      onClick={() => s.press("toggle-mic")}
    >
      <Icon name={recording ? "mic" : "mic_off"} filled={recording} />
      {recording && (
        <span
          className="pn-level"
          aria-hidden="true"
          data-testid="pn-level"
          data-active={s.live.interim === "" ? undefined : "true"}
        >
          <i />
          <i />
          <i />
        </span>
      )}
    </button>
  );
}

// The one See-through switch: clear glass, and (where the shell can) pass-through
// over empty glass. The Mini player draws the same one.
export function SeeThroughButton({
  glass,
  passThrough,
}: {
  glass: PanelGlass;
  passThrough: boolean;
}) {
  // [SAFETY] Never locked: with clear glass on, See-through is how a person gets
  // the window back, and the choice outlives sign-out. The lock names what is
  // missing for the other controls; this one needs nothing.
  return (
    <button
      type="button"
      className="pn-bar-button pn-icon-button"
      data-testid="pn-see-through"
      aria-label={SEE_THROUGH_CONTROL.label}
      aria-pressed={glass.clear}
      title={seeThroughTitle(glass.clear, passThrough)}
      onClick={glass.toggle}
    >
      <Icon name={SEE_THROUGH_CONTROL.icon} />
    </button>
  );
}

export function Toolbar({
  s,
  controls,
  trailing,
}: {
  s: PanelSession;
  controls: WindowControls;
  // After the keyboard button: the start screens' account chip. None while live.
  trailing?: ReactNode;
}) {
  const lock = useToolbarLock();
  const control = captureControl(Boolean(s.phase));
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [dotPopup, setDotPopup] = useState(false);
  const onMenuOpen = controls.onMenuOpen;
  const anyOpen = menu !== null || dotPopup;
  useEffect(() => onMenuOpen(anyOpen), [anyOpen, onMenuOpen]);
  const toggle = (id: MenuId) => (open: boolean) => setMenu(open ? id : null);
  const skill = SKILLS.find((option) => option.id === s.skill)?.label ?? "";
  const mode = captureModeOf(s.auto.on);
  const passThrough = canPassThrough(controls.presentation);
  // Escape from the screen menu gives focus back to where it was opened from:
  // the capture button (right-click, ArrowDown) or the chevron.
  const captureRef = useRef<HTMLButtonElement>(null);
  const openedFromCapture = useRef(false);
  return (
    <div
      className="pn-pill"
      role="toolbar"
      aria-label="Session controls"
      data-testid="pn-pill"
      data-locked={lock !== null ? "true" : undefined}
    >
      <WindowDots
        s={s}
        presentation={controls.presentation}
        windowMode={controls.windowMode}
        onPopup={setDotPopup}
      />
      <div className="pn-split" data-stop={control.stop ? "true" : undefined}>
        <CaptureButton
          s={s}
          buttonRef={captureRef}
          menuOpen={menu === "screen"}
          {...(displaySelectionAvailable()
            ? {
                onOpenTargets: () => {
                  openedFromCapture.current = true;
                  setMenu("screen");
                },
              }
            : {})}
        />
        {displaySelectionAvailable() && (
          <ScreenPicker
            s={s}
            open={menu === "screen"}
            onOpenChange={(open) => {
              if (!open) openedFromCapture.current = false;
              toggle("screen")(open);
            }}
            returnFocus={() =>
              openedFromCapture.current ? captureRef.current : null
            }
          />
        )}
        <Popover
          open={menu === "mode"}
          onOpenChange={toggle("mode")}
          className="pn-split-menu"
          label="Capture mode"
          triggerLabel={`Capture mode: ${mode.label}`}
          title="How the screen is captured"
          kind="menu"
          panelClassName="pn-menu"
          trigger={
            <>
              {mode.label}
              <Icon name="expand_more" />
            </>
          }
        >
          {(close) =>
            captureMenuItems({
              mode: mode.id,
              auto: s.auto.limits,
              target: s.target?.targetLabel ?? null,
              open: s.open,
            }).map((item) => {
              const isMode = item.id !== "attach";
              return (
                <button
                  key={item.id}
                  type="button"
                  role={isMode ? "menuitemradio" : "menuitem"}
                  aria-checked={isMode ? item.checked : undefined}
                  aria-disabled={item.disabledReason !== null}
                  className="pn-menu-item"
                  onClick={() => {
                    if (item.disabledReason !== null) return;
                    if (item.id === "attach") s.press("attach");
                    else s.setAuto(captureModeOf(item.id === "auto").on);
                    close();
                  }}
                >
                  <Icon
                    name="check"
                    style={{ opacity: item.checked ? 1 : 0 }}
                  />
                  <span>
                    <span className="pn-menu-label">{item.label}</span>
                    <span className="pn-menu-sub">{item.subtitle}</span>
                  </span>
                </button>
              );
            })
          }
        </Popover>
      </div>
      <MicButton s={s} />
      <Popover
        open={menu === "skill"}
        onOpenChange={toggle("skill")}
        className="pn-bar-button pn-skill"
        label="Answer style"
        triggerLabel={`Answer style: ${skill}`}
        title={`Answer style · ${nativeChord("skill-previous")} ${nativeChord("skill-next")}`}
        testId="pn-skill"
        kind="menu"
        panelClassName="pn-menu pn-menu-narrow"
        trigger={
          <>
            <span className="pn-skill-name">{skill}</span>
            <Icon name="expand_more" />
          </>
        }
      >
        {(close) => (
          <>
            <div className="pn-menu-head" role="presentation">
              Answer style for new work
            </div>
            {SKILLS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.id === (s.skill ?? DEFAULT_SKILL)}
                className="pn-menu-item"
                onClick={() => {
                  s.setSkill(option.id);
                  close();
                }}
              >
                <Icon
                  name="check"
                  style={{
                    opacity: option.id === (s.skill ?? DEFAULT_SKILL) ? 1 : 0,
                  }}
                />
                {option.label}
              </button>
            ))}
          </>
        )}
      </Popover>
      {s.card?.modelLabel && (
        <span
          className="pn-model"
          title={`Generated by ${s.card.modelLabel}`}
          data-testid="pn-model"
        >
          {s.card.modelLabel}
        </span>
      )}
      <span className="pn-divider" aria-hidden="true" />
      {PANES.map((pane) => (
        <button
          key={pane.id}
          type="button"
          className="pn-bar-button pn-icon-button"
          aria-label={pane.label}
          aria-pressed={controls.panes.shown[pane.id]}
          title={lock ?? pane.title}
          disabled={lock !== null}
          onClick={() => controls.panes.toggle(pane.id)}
        >
          <Icon name={pane.icon} />
        </button>
      ))}
      <SeeThroughButton glass={controls.glass} passThrough={passThrough} />
      <Popover
        open={menu === "keys"}
        onOpenChange={toggle("keys")}
        className="pn-bar-button pn-icon-button"
        label="Keyboard shortcuts"
        title="Shortcuts"
        kind="dialog"
        panelClassName="pn-menu pn-keys"
        trigger={<Icon name="keyboard" />}
      >
        {() => (
          <ul className="pn-keys-list">
            {shortcutsFor("native").map((shortcut) => (
              <li key={shortcut.id}>
                <span>{shortcut.label}</span>
                <kbd>{shortcut.chord}</kbd>
              </li>
            ))}
          </ul>
        )}
      </Popover>
      {/* The chip is not a session control: it stays live under the lock. */}
      {trailing && (
        <ToolbarLock.Provider value={null}>{trailing}</ToolbarLock.Provider>
      )}
    </div>
  );
}
