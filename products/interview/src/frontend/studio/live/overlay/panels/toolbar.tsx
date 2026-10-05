// The toolbar, drawn from the tables in toolbar-config.ts: the capture button
// with its mode menu, the microphone, the answer style, the model chip, the pane
// toggles, click-through and the shortcut list. It holds no session logic:
// every control calls the one panel session.
//
// [SAFETY] Nothing here hides a window or conceals capture; click-through only
// lets the mouse reach the page underneath, and the window stays visible.
import type { PresentationHost } from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { Icon } from "../../../icon";
import { nativeChord, shortcutsFor } from "../../shared/shortcuts";
import { SKILLS } from "../../shared/skills";
import { DEFAULT_SKILL } from "./commands";
import type { PanelSession } from "./panel-views";
import { Popover } from "./popover";
import { hasCapability } from "./presentation-host";
import type { Panes } from "./single-panel";
import {
  captureControl,
  captureMenuItems,
  captureModeOf,
  hideBlockedReason,
  PANES,
  WINDOW_CONTROLS,
  type WindowControlAction,
} from "./toolbar-config";

type Tone = "green" | "red" | "neutral";

// green: interaction on. red: interaction off, or recording.
function pillTone(s: PanelSession): { tone: Tone; label: string } {
  if (!s.open) return { tone: "neutral", label: "Ended" };
  if (s.live.mic === "listening") return { tone: "red", label: "Recording" };
  if (s.interaction === false) return { tone: "red", label: "Interaction off" };
  return { tone: "green", label: "Interaction on" };
}

type MenuId = "mode" | "skill" | "keys";

// What the one window gives the toolbar.
type WindowControls = {
  panes: Panes;
  presentation: PresentationHost;
  // A menu is open: the window keeps room below the bar for it.
  onMenuOpen(open: boolean): void;
};

// The window's own controls. Red hides it, which is only offered where the
// shell can bring it back (a native window) and only while the session is not
// capturing or listening; otherwise it stays disabled, with its reason, so the
// window can never be made invisible while it works, or without a way back.
export function WindowDots({
  panes,
  presentation,
  dimmed,
  hideBlocked,
}: {
  panes: Panes;
  presentation: PresentationHost;
  dimmed: boolean;
  // Why hide is refused right now (capturing or listening), or null.
  hideBlocked: string | null;
}) {
  const recoverable = hasCapability(presentation, "always-on-top");
  const run: Record<WindowControlAction, () => void> = {
    hide: () => void presentation.setVisible(false),
    collapse: () => panes.setAll(false),
    expand: () => panes.setAll(true),
  };
  return (
    <div
      className="pn-dots"
      role="group"
      aria-label="Window controls"
      data-dimmed={dimmed ? "true" : undefined}
    >
      {WINDOW_CONTROLS.map((control) => {
        const hide = control.action === "hide";
        const unavailable = hide && (!recoverable || hideBlocked !== null);
        return (
          <button
            key={control.id}
            type="button"
            className="pn-window-dot"
            data-colour={control.colour}
            data-testid={`pn-dot-${control.id}`}
            aria-label={control.label}
            title={
              hide && hideBlocked !== null
                ? hideBlocked
                : unavailable
                  ? "Only the Mac app can hide its window and bring it back"
                  : control.title
            }
            disabled={unavailable}
            onClick={run[control.action]}
          >
            <span aria-hidden="true">{control.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toolbar({
  s,
  controls,
}: {
  s: PanelSession;
  controls: WindowControls;
}) {
  const status = pillTone(s);
  const recording = s.live.mic === "listening";
  const control = captureControl(Boolean(s.phase));
  const [menu, setMenu] = useState<MenuId | null>(null);
  const onMenuOpen = controls.onMenuOpen;
  useEffect(() => onMenuOpen(menu !== null), [menu, onMenuOpen]);
  const toggle = (id: MenuId) => (open: boolean) => setMenu(open ? id : null);
  const skill = SKILLS.find((option) => option.id === s.skill)?.label ?? "";
  const mode = captureModeOf(s.auto.on);
  const clickThrough = s.interaction === false;
  return (
    <div
      className="pn-pill"
      role="toolbar"
      aria-label="Session controls"
      data-testid="pn-pill"
    >
      <WindowDots
        panes={controls.panes}
        presentation={controls.presentation}
        dimmed={clickThrough}
        hideBlocked={hideBlockedReason(s)}
      />
      <div className="pn-split" data-stop={control.stop ? "true" : undefined}>
        <button
          type="button"
          className="pn-split-main"
          aria-label={control.label}
          title={`${control.title} · ${nativeChord("analyze")}`}
          disabled={!s.open || s.phase === "capturing"}
          onClick={() => s.press("capture")}
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
      <button
        type="button"
        className="pn-bar-button pn-icon-button pn-mic-button"
        aria-label={recording ? "Stop microphone" : "Start microphone"}
        title={`${recording ? "Stop microphone" : "Start microphone"} · ${nativeChord("listening")}`}
        aria-pressed={recording}
        data-mic={s.live.mic}
        disabled={!s.open}
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
          title={pane.title}
          onClick={() => controls.panes.toggle(pane.id)}
        >
          <Icon name={pane.icon} />
        </button>
      ))}
      {s.interaction !== null && (
        <button
          type="button"
          className="pn-bar-button pn-icon-button"
          aria-label="Click-through"
          aria-pressed={clickThrough}
          title={
            clickThrough
              ? `Click-through on · ${nativeChord("click-through")} to interact`
              : `Interactive · ${nativeChord("click-through")} for click-through`
          }
          onClick={() =>
            void controls.presentation.setInteractionMode(clickThrough)
          }
        >
          <Icon name="desktop_windows" />
        </button>
      )}
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
            {shortcutsFor("native").map((shortcut) => {
              // Registered by the shell only while the window takes the mouse.
              const off = clickThrough && shortcut.requiresInteractive === true;
              return (
                <li
                  key={shortcut.id}
                  aria-disabled={off ? "true" : undefined}
                  data-disabled={off ? "true" : undefined}
                >
                  <span>{shortcut.label}</span>
                  <kbd>{shortcut.chord}</kbd>
                  {off && <small>Only while interactive</small>}
                </li>
              );
            })}
          </ul>
        )}
      </Popover>
    </div>
  );
}
