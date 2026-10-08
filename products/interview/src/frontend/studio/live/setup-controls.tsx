// Small form controls for the Setup view: a segmented radiogroup, a switch row,
// a radio card and a titled setting row. All are keyboard operable and carry
// their accessible name themselves.
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { Icon, type IconName } from "../icon";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
};

// A radiogroup with a roving tab stop: Tab reaches the checked option, the
// arrow keys move and select (wrapping), Home and End jump to the ends.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange(value: T): void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function move(index: number, event: KeyboardEvent) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : step === 0
            ? null
            : (index + step + options.length) % options.length;
    if (target === null) return;
    event.preventDefault();
    const option = options[target];
    if (!option) return;
    onChange(option.value);
    buttons.current[target]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} className="setup-segmented">
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled button is the radio here; a native input would change the element and its styling
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`setup-segment${checked ? " on" : ""}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(index, event)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// One option with a title, a description and an on/off switch. `reason`
// explains a disabled switch, and is tied to it for assistive technology.
export function SwitchRow({
  id,
  title,
  description,
  on,
  disabled = false,
  reason,
  onChange,
  children,
}: {
  id: string;
  title: string;
  description: string;
  on: boolean;
  disabled?: boolean;
  reason?: string;
  onChange(on: boolean): void;
  children?: ReactNode;
}) {
  const describedBy = reason ? `${id}-reason` : `${id}-description`;
  return (
    <div className={`setup-row${disabled ? " disabled" : ""}`}>
      <div className="setup-row-text">
        <div className="setup-row-title" id={`${id}-title`}>
          {title}
        </div>
        <div className="setup-muted" id={`${id}-description`}>
          {description}
        </div>
        {reason && (
          <div className="setup-muted setup-reason" id={`${id}-reason`}>
            {reason}
          </div>
        )}
        {children}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-title`}
        aria-describedby={describedBy}
        disabled={disabled}
        className={`setup-switch${on ? " on" : ""}`}
        onClick={() => onChange(!on)}
      >
        <span />
      </button>
    </div>
  );
}

// A radio card: the native radio is the control (visually hidden, covering the
// card), so keyboard and screen-reader behaviour is the browser's own.
export function CardOption({
  name,
  checked,
  onSelect,
  icon,
  title,
  sub,
  status,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect(): void;
  icon?: IconName;
  title: string;
  sub?: string;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <label className={`setup-card${checked ? " on" : ""}`}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} />
      <span className="setup-card-head">
        {icon && <Icon name={icon} />}
        <span className="setup-card-title">{title}</span>
        {status}
      </span>
      {sub && <span className="setup-muted">{sub}</span>}
      {children}
    </label>
  );
}

// A titled row of the privacy block: what it is, a note, and its control.
export function SettingRow({
  icon,
  title,
  note,
  control,
  children,
}: {
  icon: IconName;
  title: string;
  note: string;
  control: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="setup-setting">
      <div className="setup-setting-main">
        <Icon name={icon} />
        <div className="setup-setting-text">
          <div className="setup-row-title">{title}</div>
          <div className="setup-muted">{note}</div>
        </div>
        {control}
      </div>
      {children}
    </div>
  );
}
