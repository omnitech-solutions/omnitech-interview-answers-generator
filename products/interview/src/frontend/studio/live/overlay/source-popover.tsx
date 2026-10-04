// What a companion source light means: its real state, the reason the companion
// reported, and what to do about it. Never just "disconnected".
import { useEffect, useRef } from "react";
import { Icon } from "../../icon";
import { useMenuPlacement } from "./menu-placement";
import type { SourceAdvice } from "./overlay-model";
import { closeOnEscape, useDismiss } from "./use-dismiss";

export function SourcePopover({
  advice,
  action,
  onClose,
}: {
  advice: SourceAdvice;
  // An optional button for what the person can do right here.
  action?: { label: string; run(): void } | undefined;
  onClose(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, true, onClose);
  useMenuPlacement(root, true);
  useEffect(() => root.current?.focus(), []);
  return (
    <div
      ref={root}
      className="ov-menu ov-popover ov-source-popover"
      role="dialog"
      tabIndex={-1}
      aria-label={advice.title}
      data-testid="source-popover"
      onKeyDown={closeOnEscape(onClose)}
    >
      <div className="ov-popover-head">
        <span className={`ov-dot ${advice.tone}`} aria-hidden="true" />
        <strong>{advice.title}</strong>
        <span className="ov-muted">{advice.state}</span>
      </div>
      <p className="ov-popover-text" data-testid="source-reason">
        {advice.reason}
      </p>
      {advice.fix && (
        <p className="ov-popover-text" data-testid="source-fix">
          <Icon name="info" />
          {advice.fix}
        </p>
      )}
      {action && (
        <button
          type="button"
          className="ov-button"
          onClick={() => {
            onClose();
            action.run();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
