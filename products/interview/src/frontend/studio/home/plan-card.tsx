import type {
  PlanItem,
  PlanItemInput,
  PlanItemKind,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import type { StudioActions } from "../config/commands";
import { Icon, type IconName } from "../icon";
import type { StudioLists } from "../use-studio-lists";
import type { PlanState } from "./use-plan";

const KIND_ICON: Record<PlanItemKind, IconName> = {
  question: "terminal",
  briefing: "lightbulb",
  rehearsal: "timer",
  task: "check_circle",
};

// The steps between now and the interview, each reporting its linked work.
export function PlanCard({
  items,
  state,
  lists,
  actions,
}: {
  items: readonly PlanItem[];
  state: PlanState;
  lists: StudioLists;
  actions: StudioActions;
}) {
  const open = (item: PlanItem) => {
    if (item.kind === "question" && item.ref) actions.openArtifact(item.ref);
    else if (item.kind === "briefing" && item.ref)
      actions.openBriefing(item.ref);
    else if (item.kind === "rehearsal") actions.go("rehearsal");
  };
  return (
    <section className="home-card home-plan" aria-label="Prep plan">
      <div className="home-card-head">
        <span>Prep plan</span>
        <span className="ws-spacer" />
        <AddToPlan lists={lists} onAdd={(input) => void state.addItem(input)} />
      </div>
      {items.length === 0 && (
        <p className="home-muted home-empty">
          Add the questions, briefings and rehearsals you want done before the
          interview.
        </p>
      )}
      <ul className="home-plan-list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`home-plan-item${item.done ? " done" : ""}`}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={item.done}
              aria-label={`Done: ${item.title}`}
              className="home-tick"
              onClick={() =>
                void state.updateItem(item.id, { done: !item.done })
              }
            >
              {item.done && <Icon name="check" size={14} />}
            </button>
            <Icon name={KIND_ICON[item.kind]} size={17} />
            <div className="home-plan-text">
              <div className="home-plan-title">{item.title}</div>
              {item.status && (
                <div className={`home-plan-status ${item.status.tone}`}>
                  {item.status.label}
                </div>
              )}
            </div>
            {item.kind !== "task" && (
              <button
                type="button"
                className="studio-button home-open"
                onClick={() => open(item)}
              >
                Open
              </button>
            )}
            <button
              type="button"
              className="home-remove"
              aria-label={`Remove ${item.title}`}
              onClick={() => void state.removeItem(item.id)}
            >
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddToPlan({
  lists,
  onAdd,
}: {
  lists: StudioLists;
  onAdd(input: PlanItemInput): void;
}) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const add = (input: PlanItemInput) => {
    onAdd(input);
    setOpen(false);
    setTask("");
  };
  return (
    <div className="ws-versions" ref={menu}>
      <button
        type="button"
        className="studio-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <Icon name="add" size={16} />
        Add
      </button>
      {open && (
        <div className="ws-versions-menu" role="menu" aria-label="Add to plan">
          <form
            className="home-add-task"
            onSubmit={(event) => {
              event.preventDefault();
              if (task.trim())
                add({ kind: "task", ref: null, title: task.trim() });
            }}
          >
            <input
              aria-label="New task"
              placeholder="A task, e.g. read the job post"
              value={task}
              onChange={(event) => setTask(event.target.value)}
            />
          </form>
          <button
            type="button"
            role="menuitem"
            className="ws-versions-item"
            onClick={() =>
              add({
                kind: "rehearsal",
                ref: null,
                title: "Do a timed rehearsal",
              })
            }
          >
            <Icon name="timer" size={16} />
            <span>A timed rehearsal</span>
          </button>
          {lists.questions.length > 0 && (
            <div className="ws-versions-note">Questions</div>
          )}
          {lists.questions.slice(0, 8).map((question) => (
            <button
              key={question.artifactId}
              type="button"
              role="menuitem"
              className="ws-versions-item"
              onClick={() =>
                add({
                  kind: "question",
                  ref: question.artifactId,
                  title: `Solve: ${question.title}`,
                })
              }
            >
              <Icon name="terminal" size={16} />
              <span>{question.title}</span>
            </button>
          ))}
          {lists.briefings.length > 0 && (
            <div className="ws-versions-note">Briefings</div>
          )}
          {lists.briefings.slice(0, 8).map((briefing) => (
            <button
              key={briefing.id}
              type="button"
              role="menuitem"
              className="ws-versions-item"
              onClick={() =>
                add({
                  kind: "briefing",
                  ref: briefing.id,
                  title: `Brief: ${briefing.title}`,
                })
              }
            >
              <Icon name="lightbulb" size={16} />
              <span>{briefing.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
