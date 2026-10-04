// The command bar: capture, dictation, the active skill, the region and settings,
// with one status dot. These are controls, not status lights: each does
// something when pressed, and the tooltips say what and which shortcut.
import {
  LIVE_OWNER_SKILL_LABELS,
  type LiveOwnerSkill,
} from "@omnitech/interview-contracts";
import { Icon } from "../../icon";
import { DICTATION_NOTE, type DictationState } from "./dictation";
import { type ShortcutId, shortcutKeys } from "./overlay-shortcuts";

export type BarStatus =
  | "ready"
  | "listening"
  | "capturing"
  | "paused"
  | "ended";

const STATUS_LABEL: Record<BarStatus, string> = {
  ready: "Ready",
  listening: "Listening",
  capturing: "Capturing",
  paused: "Paused",
  ended: "Ended",
};
const tip = (text: string, id: ShortcutId) => `${text} (${shortcutKeys(id)})`;

export function CommandBar({
  status,
  dictation,
  skill,
  sharing,
  onCapture,
  onDictate,
  onSettings,
}: {
  status: BarStatus;
  dictation: DictationState;
  skill: LiveOwnerSkill | undefined;
  sharing: boolean;
  onCapture(): void;
  onDictate(): void;
  onSettings(): void;
}) {
  const listening = dictation === "listening";
  return (
    <div
      className="ov-bar"
      role="toolbar"
      aria-label="Capture controls"
      data-testid="command-bar"
    >
      <span
        className={`ov-bar-dot ${status}`}
        role="status"
        aria-label={STATUS_LABEL[status]}
        title={STATUS_LABEL[status]}
        data-testid="bar-status"
        data-status={status}
      />
      <button
        type="button"
        className="ov-icon-button"
        aria-label="Capture screen"
        title={tip(
          sharing ? "Capture & analyze this source" : "Choose what to capture",
          "analyze",
        )}
        onClick={onCapture}
      >
        <Icon name="center_focus_strong" />
      </button>
      <button
        type="button"
        className={`ov-icon-button ov-mic${listening ? " live" : ""}`}
        aria-label={listening ? "Stop dictation" : "Dictate"}
        aria-pressed={listening}
        title={`${tip(listening ? "Stop dictation" : "Dictate a follow-up", "dictate")}. ${DICTATION_NOTE}`}
        onClick={onDictate}
      >
        <Icon name="mic" filled={listening} />
        {listening && <span className="ov-rec" aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="ov-pill-button"
        title={tip("Interview topic: change it in settings", "settings")}
        onClick={onSettings}
      >
        {skill ? LIVE_OWNER_SKILL_LABELS[skill] : "Topic: auto"}
      </button>
      <span className="ov-spacer" />
      <button
        type="button"
        className="ov-icon-button"
        aria-label="Settings"
        title={tip("Settings and shortcuts", "settings")}
        onClick={onSettings}
      >
        <Icon name="settings" />
      </button>
    </div>
  );
}
