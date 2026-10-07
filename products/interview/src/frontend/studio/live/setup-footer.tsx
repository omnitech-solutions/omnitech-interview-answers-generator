// The Setup view's sticky footer: "Ready" or the one thing in the way, and the
// one Start button. A disabled Start points at the reason with aria-describedby.

import { Button } from "@oc-tech/omni-ui-components";
import type { Ref } from "react";
import { Icon } from "../icon";

export function SetupFooter({
  blocker,
  summary,
  note,
  pending,
  onStart,
  startRef,
}: {
  // The first thing in the way of Start; null when ready.
  blocker: string | null;
  // What will start, for the "Ready" line.
  summary: string;
  // One line on what happens next.
  note: string;
  pending: boolean;
  onStart(): void;
  startRef: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="setup-footer" data-testid="setup-footer">
      <div className="setup-footer-text">
        <div
          className={`setup-footer-title${blocker ? " blocked" : ""}`}
          id="setup-footer-state"
        >
          {blocker ?? "Ready"}
        </div>
        <div className="setup-muted">
          {blocker ? "Fix this to start." : summary}
        </div>
        <div className="setup-muted">{note}</div>
      </div>
      <Button
        variant="default"
        buttonSize="lg"
        disabled={blocker !== null || pending}
        aria-describedby="setup-footer-state"
        data-testid="start-session"
        ref={startRef}
        onClick={onStart}
      >
        <Icon name="sensors" />
        {pending ? "Starting…" : "Start session"}
      </Button>
    </div>
  );
}
