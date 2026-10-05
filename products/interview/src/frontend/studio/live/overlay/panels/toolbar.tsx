// The toolbar, drawn from the tables in toolbar-config.ts: the capture button
// with its mode menu, the microphone, the answer style, and (in the one window)
// the model chip, the pane toggles, click-through and the shortcut list. It
// holds no session logic: every control calls the one panel session.
//
// [SAFETY] Nothing here hides a window or conceals capture; click-through only
// lets the mouse reach the page underneath, and the window stays visible.
import type { PresentationHost } from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { Icon } from "../../../icon";
import { shortcutsFor } from "../../shared/shortcuts";
import { SKILLS } from "../../shared/skills";
import { DEFAULT_SKILL } from "./commands";
import type { PanelSession } from "./panel-views";
import { Popover } from "./popover";
import type { Panes } from "./single-panel";
import {
  CAPTURE_MODES,
  type CaptureMode,
  captureControl,
  captureMenuItems,
  nativeChord,
  PANES,
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

// What the one window adds to the bar.
type WindowControls = {
  panes: Panes;
  presentation: PresentationHost;
  captureMode: { value: CaptureMode; onChange(mode: CaptureMode): void };
  // A menu is open: the window keeps room below the bar for it.
  onMenuOpen(open: boolean): void;
};

export function PillPanel({
  s,
  single: extras,
}: {
  s: PanelSession;
  single?: WindowControls;
}) {
  const status = pillTone(s);
  const recording = s.live.mic === "listening";
  const control = captureControl(Boolean(s.phase));
  const [menu, setMenu] = useState<MenuId | null>(null);
  const onMenuOpen = extras?.onMenuOpen;
  useEffect(() => onMenuOpen?.(menu !== null), [menu, onMenuOpen]);
  const toggle = (id: MenuId) => (open: boolean) => setMenu(open ? id : null);
  const skill = SKILLS.find((option) => option.id === s.skill)?.label ?? "";
  const modes = extras?.captureMode;
  const clickThrough = s.interaction === false;
  return (
    <div
      className="pn-pill"
      role="toolbar"
      aria-label="Session controls"
      data-testid="pn-pill"
    >
      <div className="pn-split" data-stop={control.stop ? "true" : undefined}>
        <button
          type="button"
          className="pn-split-main"
          aria-label={control.label}
          title={control.title}
          disabled={!s.open}
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
              role="status"
              aria-label={status.label}
              title={status.label}
              data-testid="pn-dot"
            />
          </span>
          <span className="pn-split-label">{control.label}</span>
          <kbd>{nativeChord("analyze")}</kbd>
        </button>
        {modes && (
          <Popover
            open={menu === "mode"}
            onOpenChange={toggle("mode")}
            className="pn-split-menu"
            label="Capture mode"
            title="How the screen is captured"
            kind="menu"
            panelClassName="pn-menu"
            trigger={
              <>
                {CAPTURE_MODES.find((mode) => mode.id === modes.value)?.label}
                <Icon name="expand_more" />
              </>
            }
          >
            {(close) =>
              captureMenuItems({
                mode: modes.value,
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
                      else modes.onChange(item.id);
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
        )}
      </div>
      <button
        type="button"
        className="pn-bar-button pn-mic-button"
        aria-label={recording ? "Stop microphone" : "Start microphone"}
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
        <kbd>{nativeChord("listening")}</kbd>
      </button>
      <Popover
        open={menu === "skill"}
        onOpenChange={toggle("skill")}
        className="pn-bar-button pn-skill"
        label="Answer style"
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
      {extras && (
        <>
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
              className="pn-bar-button"
              aria-pressed={extras.panes.shown[pane.id]}
              title={pane.title}
              onClick={() => extras.panes.toggle(pane.id)}
            >
              <Icon name={pane.icon} />
              {pane.label}
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
                void extras.presentation.setInteractionMode(clickThrough)
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
                {shortcutsFor("native").map((shortcut) => (
                  <li key={shortcut.id}>
                    <span>{shortcut.label}</span>
                    <kbd>{shortcut.chord}</kbd>
                  </li>
                ))}
              </ul>
            )}
          </Popover>
        </>
      )}
    </div>
  );
}
