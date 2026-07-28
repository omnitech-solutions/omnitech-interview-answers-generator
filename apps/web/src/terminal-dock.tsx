"use client";

import { IconButton } from "@oc-tech/omni-ui-components";
import { useCallback, useRef, useState } from "react";
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
  const copyTerminalRef = useRef<(() => Promise<void>) | null>(null);
  const [copied, setCopied] = useState(false);
  const registerCopy = useCallback((copy: (() => Promise<void>) | null) => {
    copyTerminalRef.current = copy;
  }, []);
  const copyTerminal = async () => {
    try {
      await copyTerminalRef.current?.();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

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
          className="terminal-copy-button"
          aria-label={copied ? "Terminal copied" : "Copy terminal"}
          title={copied ? "Copied" : "Copy terminal"}
          onClick={() => void copyTerminal()}
          icon={
            copied ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect x="8" y="8" width="11" height="11" rx="2" />
                <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </svg>
            )
          }
        />
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
      {open ? (
        <BrowserTerminal sessionName={sessionName} onCopyReady={registerCopy} />
      ) : null}
    </section>
  );
}
