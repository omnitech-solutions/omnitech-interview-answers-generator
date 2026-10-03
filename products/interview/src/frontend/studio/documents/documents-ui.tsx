"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "../icon";
import { DocumentsApiError } from "./documents-client";

export function message(error: unknown): string {
  if (error instanceof DocumentsApiError) {
    if (error.code === "revision-conflict")
      return "A newer revision exists. Reload this document before editing.";
    if (error.code === "invalid-fields")
      return "The document contains invalid field values. Review the flagged fields.";
    if (error.code === "generation-unavailable")
      return "The selected model is unavailable. Choose another model.";
    if (error.code === "server-error")
      return "The Documents service returned an error. Check the server and database migrations.";
    if (error.code === "body-too-large")
      return "The template file is too large.";
    if (error.code === "invalid-field-or-template")
      return "The template or fields could not be accepted.";
  }
  return "This action could not be completed. Try again.";
}

export function Spinner() {
  return <span className="dx-spinner" aria-hidden="true" />;
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="dx-icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      {...(disabled ? { disabled } : {})}
    >
      <Icon name={icon} />
    </button>
  );
}

// The same pill group serves page tabs and filters; only the semantics differ.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  variant = "tabs",
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string; count?: number }>;
  value: T;
  onChange(id: T): void;
  variant?: "tabs" | "filter";
}) {
  return (
    <div
      className="dx-segmented"
      role={variant === "tabs" ? "tablist" : "group"}
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          {...(variant === "tabs"
            ? { role: "tab", "aria-selected": option.id === value }
            : { "aria-pressed": option.id === value })}
          data-on={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {option.count ? (
            <span className="dx-count">{option.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  tabs,
  action,
}: {
  title: string;
  description: string;
  tabs: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="dx-page-head">
      <div className="dx-page-title">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {tabs}
      {action}
    </div>
  );
}

export function Modal({
  title,
  width,
  onClose,
  footer,
  children,
}: {
  title: string;
  width: number;
  onClose(): void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dx-scrim" onMouseDown={onClose}>
      <div
        ref={panel}
        className="dx-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100%)` }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dx-modal-head">
          <span>{title}</span>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="dx-modal-body">{children}</div>
        <div className="dx-modal-foot">{footer}</div>
      </div>
    </div>
  );
}

export function useToast() {
  const [text, setText] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = useCallback((next: string) => {
    window.clearTimeout(timer.current);
    setText(next);
    timer.current = window.setTimeout(() => setText(""), 3800);
  }, []);
  const node = text ? (
    <div className="dx-toast" role="status">
      {text}
    </div>
  ) : null;
  return { show, node };
}
