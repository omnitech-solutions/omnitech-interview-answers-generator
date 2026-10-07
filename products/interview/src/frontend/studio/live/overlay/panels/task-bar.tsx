// The row above the panes, once a session has a task: Capture new problem on
// the left (asks first: it starts a NEW task); on the right the Problem menu
// (every task, newest first, the one on show checked; picking shows that task,
// it never changes revisions) and the task's revisions (a menu when it has more
// than one, plain text when it has one). Library components only.
import { ActionMenu, Button, Popconfirm } from "@oc-tech/omni-ui-components";
import { useCallback, useState } from "react";
import { Icon } from "../../../icon";
import { revisionLine } from "../../shared/revisions";
import { RevisionsControl } from "../../shared/revisions-control";
import { nativeChord } from "../../shared/shortcuts";
import { taskChips } from "./panel-model";
import type { PanelSession } from "./panel-views";

export function TaskBar({ s }: { s: PanelSession }) {
  const [open, setOpen] = useState(false);
  // The menu portals into the panel root, like the toolbar's menus.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const bar = useCallback((node: HTMLDivElement | null) => {
    setRoot(node?.closest<HTMLElement>(".pn-root") ?? null);
  }, []);
  const tasks = s.model.tasks;
  const card = s.card;
  if (!s.open || tasks.length === 0 || !card) return null;
  const chips = taskChips(tasks, s.selected?.taskId);
  const current =
    chips.find((chip) => chip.selected) ?? chips[chips.length - 1];
  const running = card.stages.some((stage) => stage.state === "running");
  return (
    <div ref={bar} className="pn-task-bar pn-card" data-testid="pn-task-bar">
      <Popconfirm
        title="Capture a new problem?"
        description="The screen is captured as a new task. The task on show keeps its answer and code."
        confirmText="Capture"
        cancelText="Not now"
        onConfirm={() => s.press("capture")}
      >
        <Button
          buttonSize="sm"
          variant="outline"
          icon={<Icon name="screenshot_monitor" />}
          shortcut={[...nativeChord("analyze")]}
          disabled={running}
          aria-label={`Capture new problem ${nativeChord("analyze")}`}
          data-testid="pn-capture-new"
        >
          Capture new problem
        </Button>
      </Popconfirm>
      <div className="pn-task-bar-end">
        <ActionMenu
          label="Problem"
          title="Problems in this session"
          width={360}
          container={root}
          open={open}
          onOpenChange={setOpen}
          sections={[
            {
              id: "problems",
              selection: "single",
              value: current?.taskId ?? "",
              items: [...chips].reverse().map((chip) => ({
                id: chip.taskId,
                label: chip.text,
                ...(chip.newest ? { description: "Current" } : {}),
              })),
            },
          ]}
          onValueChange={(_group, id) => {
            const chip = chips.find((each) => each.taskId === id);
            if (chip) s.select(chip.newest ? null : chip.taskId);
          }}
          trigger={
            <Button
              buttonSize="sm"
              variant="outline"
              iconAfter={<Icon name="expand_more" />}
              labelMaxWidth="300px"
              aria-label={`Problem: ${current?.text ?? ""}`}
              data-testid="pn-problem-button"
              className="pn-problem-trigger"
            >
              {current?.text}
            </Button>
          }
        />
        {s.selected && card.revisionCount > 1 ? (
          <RevisionsControl
            task={s.selected}
            selected={card.revision}
            variant="native"
            onPick={s.pickRevision}
            testId="pn-bar-revisions"
          />
        ) : (
          <span className="pn-task-bar-rev" data-testid="pn-bar-rev">
            {s.selected
              ? revisionLine(s.selected, card.revision).label
              : `rev ${card.revision}`}
          </span>
        )}
      </div>
    </div>
  );
}
