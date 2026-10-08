// The "Screenshots to the model" control (D35 / OBJ-8): ONE component for the
// web setup page, the native Settings window and the web live page. A radio
// group (the native radio is the control, so keyboard and screen-reader
// behaviour is the browser's own: Tab reaches the checked option, the arrow
// keys move and select) drawn from the config table in screenshot-send.ts.
// It owns no state: the caller gives the value to show and takes the change.
import type { LiveScreenshotSend } from "@omnitech/interview-contracts";
import { useId } from "react";
import {
  SAVING_TEXT,
  SCREENSHOT_SEND_OPTIONS,
  SCREENSHOT_SEND_TITLE,
} from "./screenshot-send";

// Per surface: only class names; the stylesheet has both.
const VARIANT = { native: "ssc ssc-native", web: "ssc ssc-web" } as const;
export type ScreenshotSendVariant = keyof typeof VARIANT;

export function ScreenshotSendControl({
  value,
  onChange,
  variant,
  saving = false,
  disabledReason = null,
  failure = null,
}: {
  // The saved value (or, while saving, the one being saved).
  value: LiveScreenshotSend;
  onChange(value: LiveScreenshotSend): void;
  variant: ScreenshotSendVariant;
  saving?: boolean;
  // Why the control cannot change now; null when it can.
  disabledReason?: string | null;
  // The closed line for a refused or failed save.
  failure?: string | null;
}) {
  const id = useId();
  const locked = disabledReason !== null;
  const status = saving
    ? SAVING_TEXT
    : disabledReason !== null
      ? disabledReason
      : failure;
  const statusId = `${id}-status`;
  return (
    <fieldset
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the fieldset keeps the group's disabled state and legend; radiogroup names the choice it holds
      role="radiogroup"
      className={VARIANT[variant]}
      disabled={locked || saving}
      aria-busy={saving}
      aria-describedby={status ? statusId : undefined}
      data-testid="screenshot-send"
    >
      <legend className="ssc-legend">{SCREENSHOT_SEND_TITLE}</legend>
      {SCREENSHOT_SEND_OPTIONS.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={`ssc-option${checked ? " on" : ""}`}
          >
            <input
              type="radio"
              name={`${id}-send`}
              value={option.value}
              checked={checked}
              onChange={() => {
                // A disabled group never reaches here in a browser; the guard
                // keeps one request at a time whatever calls it.
                if (!checked && !locked && !saving) onChange(option.value);
              }}
              data-testid={`screenshot-send-${option.value}`}
            />
            <span className="ssc-label">{option.label}</span>
            <span className="ssc-desc">{option.description}</span>
          </label>
        );
      })}
      {status && (
        <p
          id={statusId}
          className={`ssc-status${failure && !saving && !locked ? " bad" : ""}`}
          role={failure && !saving && !locked ? "alert" : "status"}
          data-testid="screenshot-send-status"
        >
          {status}
        </p>
      )}
    </fieldset>
  );
}
