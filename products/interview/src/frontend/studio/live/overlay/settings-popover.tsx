// Capture settings: the active skill and the coding language, both sent as
// hints with every analyze and follow-up, and the shortcut list.

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@oc-tech/omni-ui-components";
import type { LiveSessionView } from "@omnitech/interview-contracts";
import {
  LIVE_OWNER_LANGUAGE_LABELS,
  LIVE_OWNER_LANGUAGES,
  LIVE_OWNER_SKILL_LABELS,
  LIVE_OWNER_SKILLS,
  type LiveOwnerLanguage,
  type LiveOwnerSkill,
} from "@omnitech/interview-contracts";
import { useRef } from "react";
import type { SessionActions } from "../session-snapshot";
import { ScreenshotSendControl } from "../shared/screenshot-send-control";
import { useScreenshotSend } from "../shared/use-screenshot-send";
import type { CaptureSettings } from "./capture-prefs";
import { SHORTCUTS } from "./overlay-shortcuts";
import { usePortalRoot } from "./panels/portal-root";
import { closeOnEscape } from "./use-dismiss";

export function SettingsPopover({
  settings,
  onChange,
  onClose,
  session = null,
  actions,
  shortcuts = true,
}: {
  // False where the page binds no Alt chord: the list is not printed there.
  shortcuts?: boolean;
  settings: CaptureSettings;
  onChange(next: CaptureSettings): void;
  onClose(): void;
  // D35: with a session, its "Screenshots to the model" choice sits here.
  session?: LiveSessionView | null;
  actions?: Pick<SessionActions, "setScreenshotSend">;
}) {
  const send = useScreenshotSend({
    session,
    save:
      actions?.setScreenshotSend ??
      (async () => ({ ok: false, code: "unavailable" })),
  });
  const root = useRef<HTMLDivElement>(null);
  const portal = usePortalRoot();
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      {/* A strip across the card under its header: the popover hangs from it. */}
      <PopoverAnchor asChild>
        <span className="ov-settings-anchor" ref={portal.ref} />
      </PopoverAnchor>
      <PopoverContent
        ref={root}
        container={portal.container}
        className="ov-popover ov-settings"
        role="dialog"
        tabIndex={-1}
        aria-label="Capture settings"
        align="start"
        onKeyDown={closeOnEscape(onClose)}
        // Escape is closed by the handler above, which also keeps the card
        // from acting on it (it restores a maximized card).
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          root.current?.focus();
        }}
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
          language gets an answer without generated code. Both choices are sent
          as hints with every capture and follow-up.
        </p>
        {session && actions && (
          <ScreenshotSendControl
            variant="native"
            value={send.value}
            saving={send.saving}
            failure={send.failure}
            disabledReason={send.disabledReason}
            onChange={send.choose}
          />
        )}
        {shortcuts && (
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
        )}
      </PopoverContent>
    </Popover>
  );
}
