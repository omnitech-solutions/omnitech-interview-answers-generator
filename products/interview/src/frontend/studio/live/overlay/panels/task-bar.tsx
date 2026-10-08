// The row above the panes, once a session has a task: Capture new problem on
// the left (asks first: it starts a NEW task); on the right the Problem menu
// (every task, newest first, the one on show checked; picking shows that task,
// it never changes revisions) and the task's revisions (a menu when it has more
// than one, plain text when it has one). Library components only.
import { ActionMenu, Button, Popconfirm } from "@oc-tech/omni-ui-components";
import {
  LIVE_OWNER_LANGUAGE_LABELS,
  LIVE_OWNER_LANGUAGES,
  type LiveOwnerLanguage,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../../icon";
import { revisionLine, revisionList } from "../../shared/revisions";
import { nativeChord } from "../../shared/shortcuts";
import { InterviewContextChip } from "./interview-context-chip";
import { taskChips } from "./panel-model";
import type { PanelSession } from "./panel-views";

const isOwnerLanguage = (value: string): value is LiveOwnerLanguage =>
  (LIVE_OWNER_LANGUAGES as readonly string[]).includes(value);

export function TaskBar({ s }: { s: PanelSession }) {
  const [open, setOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  // The menu portals into the panel root, like the toolbar's menus.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const bar = useCallback((node: HTMLDivElement | null) => {
    setRoot(node?.closest<HTMLElement>(".pn-root") ?? null);
  }, []);
  const tasks = s.model.tasks;
  const card = s.card;
  // Only real problems are offered: a task with a question (a title, an
  // answer or code, or work still running). A stopped analysis that published
  // nothing is not a problem the person would go back to.
  const problems = tasks.filter(
    (task) =>
      (task.title?.trim() ?? "") !== "" ||
      task.current.answer !== null ||
      task.current.code !== null ||
      task.current.runs.some((run) => run.state === "running"),
  );
  const chips = taskChips(tasks, s.selected?.taskId).filter((chip) =>
    problems.some((task) => task.taskId === chip.taskId),
  );
  const current =
    chips.find((chip) => chip.selected) ?? chips[chips.length - 1];
  // A new problem captured and not yet applied is what the panes show.
  const drafting = s.tray.intent === "new" && s.tray.items.length > 0;
  const currentText = drafting ? "Select problem…" : current?.text;
  const running =
    card?.stages.some((stage) => stage.state === "running") ?? false;
  // The menu shows and sets the hint in force. Switching to a problem sets the
  // hint to that problem's code language (the effect below), so the menu reads
  // the problem on show and a choice made afterwards still sticks.
  const shownLanguage: LiveOwnerLanguage | "auto" = s.hints.language;
  const languageLabel =
    shownLanguage === "auto"
      ? "Language: auto"
      : LIVE_OWNER_LANGUAGE_LABELS[shownLanguage];
  const taskLanguage =
    !drafting && card?.code && isOwnerLanguage(card.code.language)
      ? card.code.language
      : null;
  const lastTask = useRef<string | null>(null);
  const setLanguage = s.setLanguage;
  useEffect(() => {
    const id = drafting ? null : (current?.taskId ?? null);
    if (id === lastTask.current) return;
    lastTask.current = id;
    if (id && taskLanguage) setLanguage(taskLanguage);
  }, [current?.taskId, drafting, taskLanguage, setLanguage]);
  if (!s.open || !card || (!current && !drafting)) return null;
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
      {/* The code language in force: the problem on show's own (a switch sets
          it), changed from the menu beside Regenerate. */}
      <span className="pn-task-bar-rev" data-testid="pn-task-bar-language">
        {languageLabel}
      </span>
      {/* The interview this session is for: its job spec and brief, editable
          here; a regenerate reads the change. */}
      <InterviewContextChip candidacyId={s.model.candidacyId} />
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
              value: drafting ? "" : (current?.taskId ?? ""),
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
              aria-label={`Problem: ${currentText ?? ""}`}
              data-testid="pn-problem-button"
              className="pn-problem-trigger"
            >
              {currentText}
            </Button>
          }
        />
        {drafting ? null : s.selected && card.revisionCount > 1 ? (
          <ActionMenu
            label="Revisions"
            title="Every revision of this task"
            width={300}
            container={root}
            open={revisionsOpen}
            onOpenChange={setRevisionsOpen}
            sections={[
              {
                id: "revisions",
                selection: "single",
                value: String(card.revision),
                items: revisionList(s.selected, card.revision).map((entry) => ({
                  id: String(entry.revision),
                  label: `rev ${entry.revision}${entry.isCurrent ? " · Current" : ""}${entry.outdated ? " · Outdated" : ""}`,
                  ...(entry.cause ? { description: entry.cause } : {}),
                })),
              },
            ]}
            onValueChange={(_group, id) => s.pickRevision(Number(id))}
            trigger={
              <Button
                buttonSize="sm"
                variant="outline"
                icon={<Icon name="history" />}
                iconAfter={<Icon name="expand_more" />}
                aria-label={`Revisions: ${revisionLine(s.selected, card.revision).label}`}
                data-testid="pn-bar-revisions-button"
              >
                {revisionLine(s.selected, card.revision).label}
              </Button>
            }
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
