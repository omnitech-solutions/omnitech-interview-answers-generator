"use client";

import { IconButton } from "@oc-tech/omni-ui-components";
import type { ReactNode } from "react";

export function InspectorToggleButton({
  onToggle,
  open,
}: {
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <IconButton
      variant={open ? "secondary" : "outline"}
      className="inspector-toggle-button"
      aria-label={open ? "Hide inspector" : "Show inspector"}
      aria-pressed={open}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onToggle}
      icon={
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16" />
        </svg>
      }
    />
  );
}

export function StudioInspector({
  className = "",
  children,
  description,
  onOpenChange,
  open,
  title = "Inspector",
}: {
  className?: string;
  children: ReactNode;
  description: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  preserveOnOutsideInteraction?: boolean;
  title?: string;
}) {
  if (!open) return null;

  return (
    <aside
      className={`inspector-drawer ${className}`}
      aria-label={title}
      aria-modal="false"
      role="dialog"
    >
      <header className="inspector-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="inspector-dismiss"
          aria-label="Dismiss drawer"
          onClick={() => onOpenChange(false)}
        >
          ×
        </button>
      </header>
      <div className="inspector-scroll">{children}</div>
    </aside>
  );
}
