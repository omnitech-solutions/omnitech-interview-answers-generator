"use client";

import { IconButton } from "@oc-tech/omni-ui-components";
import { BrowserTerminal } from "./browser-terminal";

export function TerminalToggleButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      variant={open ? "secondary" : "outline"}
      className="terminal-toggle-button"
      aria-label={open ? "Hide terminal" : "Show terminal"}
      aria-pressed={open}
      onClick={onToggle}
      icon={
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3M13 15h4" />
        </svg>
      }
    />
  );
}

export function TerminalDock({
  className = "",
  onClose,
  open,
  sessionName = "workspace",
}: {
  className?: string;
  onClose: () => void;
  open: boolean;
  sessionName?: string;
}) {
  return (
    <section
      className={`terminal-dock ${className} ${
        open ? "" : "terminal-dock-hidden"
      }`}
      aria-label="Terminal"
    >
      <div className="terminal-titlebar">
        <strong>Terminal</strong>
        <span className="terminal-cwd">
          tmux · {sessionName} · project root
        </span>
        <IconButton
          className="terminal-close-button"
          aria-label="Close terminal"
          onClick={onClose}
          icon={
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m7 7 10 10M17 7 7 17" />
            </svg>
          }
        />
      </div>
      {open ? <BrowserTerminal sessionName={sessionName} /> : null}
    </section>
  );
}
