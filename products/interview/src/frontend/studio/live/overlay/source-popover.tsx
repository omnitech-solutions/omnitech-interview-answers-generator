// What a companion source light means: its real state, the reason the companion
// reported, and what to do about it. Never just "disconnected".
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tag,
} from "@oc-tech/omni-ui-components";
import { useRef } from "react";
import { Icon } from "../../icon";
import type { SourceAdvice } from "./overlay-model";
import { usePortalRoot } from "./panels/portal-root";

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
  const panel = useRef<HTMLDivElement>(null);
  const portal = usePortalRoot();
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      {/* The light's own wrapper is the anchor: the popover hangs from it. */}
      <PopoverAnchor asChild>
        <span className="ov-popover-anchor" ref={portal.ref} />
      </PopoverAnchor>
      <PopoverContent
        ref={panel}
        container={portal.container}
        role="dialog"
        aria-label={advice.title}
        data-testid="source-popover"
        className="ov-popover"
        align="end"
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panel.current?.focus();
        }}
      >
        <div className="ov-popover-head">
          <span className={`ov-dot ${advice.tone}`} aria-hidden="true" />
          <strong>{advice.title}</strong>
          <Tag variant="filled">{advice.state}</Tag>
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
          <Button
            variant="outline"
            buttonSize="sm"
            onClick={() => {
              onClose();
              action.run();
            }}
          >
            {action.label}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
