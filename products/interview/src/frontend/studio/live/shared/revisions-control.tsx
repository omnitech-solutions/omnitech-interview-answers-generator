// The Revisions control: a button naming the revision on show ("rev 2 of 3")
// and a popover list of every revision, newest first, the current one marked.
// One component and one list for the native window and the web page; each
// surface passes a variant (its class names) and what choosing does.
// Choosing is view-only: it changes which revision is shown, never the task.
import { useState } from "react";
import { Icon } from "../../icon";
import { Popover } from "../overlay/panels/popover";
import type { TaskView } from "../session-tasks";
import { type RevisionEntry, revisionLine, revisionList } from "./revisions";

// Per surface: the class names its stylesheet already has.
const VARIANT = {
  native: {
    root: "pn-revisions",
    button: "pn-mini-button",
    panel: "pn-menu pn-menu-narrow",
    item: "pn-menu-item",
    label: "pn-menu-label",
    sub: "pn-menu-sub",
  },
  web: {
    root: "live-rev",
    button: "live-chip live-chip-button",
    panel: "live-rev-menu",
    item: "live-rev-item",
    label: "live-rev-label",
    sub: "live-rev-sub",
  },
} as const;
export type RevisionsVariant = keyof typeof VARIANT;

// The marks a row can carry, in the order they read.
const MARKS: {
  id: "current" | "outdated";
  label: string;
  on(entry: RevisionEntry): boolean;
}[] = [
  { id: "current", label: "Current", on: (entry) => entry.isCurrent },
  { id: "outdated", label: "Outdated", on: (entry) => entry.outdated },
];

const timeOf = (iso: string): string => {
  const at = Date.parse(iso);
  return Number.isNaN(at)
    ? ""
    : new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
};

export function RevisionsControl({
  task,
  selected,
  variant,
  onPick,
  testId,
}: {
  // The task itself (all its revisions), not a view of one revision.
  task: TaskView;
  selected: number;
  variant: RevisionsVariant;
  onPick(revision: number): void;
  // Test ids, so a second control (the Code panel's) is told apart from the
  // Answer pane's: `${testId}-button`, `${testId}-item-N`; the default keeps
  // the ids the Answer pane's tests use.
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  // One revision: nothing to choose between.
  if (task.revisions.length < 2) return null;
  const look = VARIANT[variant];
  const line = revisionLine(task, selected);
  const ids = testId
    ? { root: testId, button: `${testId}-button`, item: `${testId}-item` }
    : { root: "revisions", button: "revisions-button", item: "revision" };
  return (
    <span className={look.root} data-testid={ids.root}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        className={look.button}
        label="Revisions"
        triggerLabel={`Revisions: ${line.label}`}
        title="Every revision of this task"
        kind="menu"
        panelClassName={look.panel}
        testId={ids.button}
        trigger={
          <>
            <Icon name="history" />
            {line.label}
            <Icon name="expand_more" />
          </>
        }
      >
        {(close) =>
          revisionList(task, selected).map((entry) => (
            <button
              key={entry.revision}
              type="button"
              role="menuitemradio"
              aria-checked={entry.isSelected}
              className={look.item}
              data-testid={`${ids.item}-${entry.revision}`}
              data-current={entry.isCurrent || undefined}
              data-outdated={entry.outdated || undefined}
              onClick={() => {
                onPick(entry.revision);
                close();
              }}
            >
              <Icon
                name="check"
                style={{ opacity: entry.isSelected ? 1 : 0 }}
              />
              <span>
                <span className={look.label}>
                  rev {entry.revision}
                  {MARKS.filter((mark) => mark.on(entry)).map((mark) => (
                    <span key={mark.id} data-mark={mark.id}>
                      {" · "}
                      {mark.label}
                    </span>
                  ))}
                </span>
                <span className={look.sub}>
                  {[entry.cause, timeOf(entry.at)].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))
        }
      </Popover>
    </span>
  );
}
