// Capture settings: the active skill and the coding language, both sent as
// hints with every analyze and follow-up, and the shortcut list.
import {
  LIVE_OWNER_LANGUAGE_LABELS,
  LIVE_OWNER_LANGUAGES,
  LIVE_OWNER_SKILL_LABELS,
  LIVE_OWNER_SKILLS,
  type LiveOwnerLanguage,
  type LiveOwnerSkill,
} from "@omnitech/interview-contracts";
import { useEffect, useRef } from "react";
import type { CaptureSettings } from "./capture-prefs";
import { SHORTCUTS } from "./overlay-shortcuts";
import { closeOnEscape, useDismiss } from "./use-dismiss";

export function SettingsPopover({
  settings,
  onChange,
  onClose,
}: {
  settings: CaptureSettings;
  onChange(next: CaptureSettings): void;
  onClose(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, true, onClose);
  useEffect(() => root.current?.focus(), []);
  return (
    <div
      ref={root}
      className="ov-menu ov-popover ov-settings"
      role="dialog"
      tabIndex={-1}
      aria-label="Capture settings"
      onKeyDown={closeOnEscape(onClose)}
      data-testid="settings-popover"
    >
      <label className="ov-field">
        <span className="ov-field-label">Topic</span>
        <select
          className="ov-select"
          value={settings.skill ?? ""}
          onChange={(event) => {
            const skill = LIVE_OWNER_SKILLS.find(
              (value) => value === event.target.value,
            ) as LiveOwnerSkill | undefined;
            onChange({ ...settings, skill });
          }}
        >
          <option value="">Auto-detect</option>
          {LIVE_OWNER_SKILLS.map((value) => (
            <option key={value} value={value}>
              {LIVE_OWNER_SKILL_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="ov-field">
        <span className="ov-field-label">Coding language</span>
        <select
          className="ov-select"
          value={settings.language ?? ""}
          onChange={(event) => {
            const language = LIVE_OWNER_LANGUAGES.find(
              (value) => value === event.target.value,
            ) as LiveOwnerLanguage | undefined;
            onChange({ ...settings, language });
          }}
        >
          <option value="">Auto-detect</option>
          {LIVE_OWNER_LANGUAGES.map((value) => (
            <option key={value} value={value}>
              {LIVE_OWNER_LANGUAGE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <p className="ov-menu-note">
        Code is generated in TypeScript or React today. A problem in another
        language gets an answer without generated code. Both choices are sent as
        hints with every capture and follow-up.
      </p>
      <div className="ov-shortcuts" aria-label="Shortcuts">
        <div className="ov-field-label">Shortcuts</div>
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.id} className="ov-shortcut">
            <kbd>{shortcut.keys}</kbd>
            <span>{shortcut.label}</span>
          </div>
        ))}
        <div className="ov-shortcut">
          <kbd>Esc</kbd>
          <span>Close a menu</span>
        </div>
      </div>
    </div>
  );
}
