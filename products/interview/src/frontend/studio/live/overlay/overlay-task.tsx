// The selected task inside the card: header (T<n> · rev, kind, title,
// provenance), the two action slots, the approach or answer, the collapsible
// solution and the collapsed Transcript and Activity rows. All text from the
// session is rendered as inert text.
import { useState } from "react";
import { Icon, type IconName } from "../../icon";
import type { TaskView } from "../session-tasks";
import { TASK_KIND } from "../task-panels";
import type { SessionDraftLink } from "../workspace-handoff";
import { LiveCodeCanvas } from "./code-canvas";
import {
  type Approach,
  type DisclosureRow,
  type ProvenanceChip,
  type SlotView,
  type SolutionView,
} from "./overlay-model";

function Spinner() {
  return <span className="ov-spinner" role="presentation" />;
}

export function TaskHead({
  task,
  number,
  chips,
}: {
  task: TaskView;
  number: number;
  chips: ProvenanceChip[];
}) {
  const kind = TASK_KIND[task.kind];
  const current = task.constraints.filter((c) => c.status === "current");
  return (
    <div className="ov-task-head" data-testid="task-head">
      <div className="ov-task-line">
        <span className="ov-tag ov-mono" data-testid="task-tag">
          T{number} · rev {task.currentRevision}
        </span>
        <span className="ov-muted">{kind.label}</span>
      </div>
      <div className="ov-task-title">{task.title ?? kind.label}</div>
      {chips.length > 0 && (
        <div className="ov-chip-row" aria-label="Based on">
          {chips.map((chip) => (
            <span key={chip.label} className="ov-pill">
              <Icon name={chip.icon} />
              {chip.label}
            </span>
          ))}
        </div>
      )}
      {current.map((constraint) => (
        <div key={constraint.text} className="ov-constraint">
          <Icon name="rule" />
          <span>{constraint.text}</span>
          {constraint.sinceRevision !== task.currentRevision && (
            <span className="ov-mono ov-faint ov-nowrap">
              from rev {constraint.sinceRevision}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function Slots({ slots }: { slots: SlotView[] }) {
  return (
    <div className="ov-slots" data-testid="slots">
      {slots.map((slot) => (
        <div
          key={slot.name}
          className={`ov-slot ${slot.tone}`}
          data-testid={`slot-${slot.name === "ANSWER SLOT" ? "answer" : "code"}`}
          data-tone={slot.tone}
          aria-busy={slot.tone === "busy"}
        >
          <span className="ov-slot-mark">
            {slot.tone === "busy" ? (
              <Spinner />
            ) : (
              <span className="ov-slot-dot" />
            )}
          </span>
          <div>
            <div className="ov-slot-name">{slot.name}</div>
            <div className="ov-slot-text">{slot.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ApproachBlock({
  title,
  approach,
  numbered,
}: {
  title: "APPROACH" | "ANSWER";
  approach: Approach;
  numbered: boolean;
}) {
  return (
    <section
      className="ov-block"
      aria-label={title === "APPROACH" ? "Approach" : "Answer"}
    >
      <div className="ov-block-head">
        <span className="ov-block-title">{title}</span>
        <span className={`ov-validated ${approach.tag.tone}`}>
          <Icon
            name={approach.tag.tone === "ok" ? "check_circle" : "history"}
          />
          {approach.tag.text}
        </span>
      </div>
      {approach.items.map((item, index) =>
        item.kind === "code" ? (
          <pre key={`${index}-code`} className="ov-code ov-approach-code">
            {item.text}
          </pre>
        ) : (
          <div key={`${index}-${item.text}`} className="ov-approach-line">
            {numbered && (
              <span className="ov-mono ov-faint">
                {approach.items.slice(0, index).filter((i) => i.kind === "line")
                  .length + 1}
              </span>
            )}
            <span>{item.text}</span>
          </div>
        ),
      )}
    </section>
  );
}

export function SolutionBlock({
  solution,
  onCopy,
  workspace,
  onOpenWorkspace,
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
  solution: SolutionView;
  onCopy(text: string): void;
  workspace: SessionDraftLink | null;
  onOpenWorkspace(link: SessionDraftLink): void;
}) {
  // The person's own choice wins over the size's default.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? defaultOpen;
  const setOpen = setChosen;
  return (
    <div className="ov-solution" data-testid="solution">
      <button
        type="button"
        className="ov-solution-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="code" />
        <span className="ov-solution-title">
          Solution · {solution.language}
        </span>
        <span className="ov-muted">{solution.status}</span>
        <Icon name={open ? "expand_less" : "expand_more"} />
      </button>
      {open && (
        <>
          <LiveCodeCanvas
            result={solution.result}
            revision={solution.revision}
            size={defaultOpen ? "maximized" : "compact"}
            onCopy={onCopy}
          />
          <ul className="ov-badges" aria-label="Verification">
            {solution.badges.map((badge) => (
              <li key={badge.label} data-ok={badge.ok}>
                <Icon
                  name={badge.ok ? "check_circle" : "radio_button_unchecked"}
                  filled={badge.ok}
                />
                {badge.label}
              </li>
            ))}
          </ul>
          <div className="ov-solution-actions">
            <button
              type="button"
              className="ov-button"
              disabled={!workspace}
              onClick={() => workspace && onOpenWorkspace(workspace)}
            >
              <Icon name="terminal" />
              Open in Workspace
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Disclosure({
  label,
  preview,
  rows,
  icon,
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
  label: string;
  preview: string;
  rows: DisclosureRow[];
  icon?: IconName;
}) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? defaultOpen;
  const setOpen = setChosen;
  return (
    <div className="ov-disclosure">
      <button
        type="button"
        className="ov-disclosure-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? "expand_less" : "expand_more"} />
        {icon && <Icon name={icon} />}
        <span className="ov-disclosure-label">{label}</span>
        <span className="ov-disclosure-preview">{preview}</span>
      </button>
      {open && (
        <div className="ov-disclosure-rows">
          {rows.length === 0 && <span className="ov-muted">Nothing yet</span>}
          {rows.map((row) => (
            <div key={row.key} className="ov-disclosure-row">
              <span className="ov-mono ov-faint">{row.tag}</span>
              <span>{row.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
