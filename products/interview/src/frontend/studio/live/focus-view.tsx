// The Focus presentation: the same session, compact. It is composed from the
// existing result components (TaskPanel, TaskSelector, IdleState) and reads
// only the one store; it fetches, converses and edits nothing of its own. The
// float renders this same component in its own window. Nothing here moves
// keyboard focus when a result arrives.
import { useCallback } from "react";
import { Icon } from "../icon";
import { FocusControls } from "./focus-controls";
import { focusFacts } from "./focus-model";
import { presentation, usePresentation } from "./focus-presentation";
import { copyText } from "./live-session-view";
import { PresentationSwitch } from "./presentation-switch";
import { isOpenSession } from "./session-deps";
import { IdleState, TaskPanel, TaskSelector } from "./task-panels";
import { useLiveSession } from "./use-live-session";
import { useSessionDraftLink } from "./workspace-handoff";

export function FocusView({ variant = "tab" }: { variant?: "tab" | "float" }) {
  const { snapshot, actions, model } = useLiveSession();
  const { pinnedTaskId } = usePresentation();
  const session = snapshot.session;
  const tasks = model.tasks;
  const newest = tasks[tasks.length - 1];
  const selected = tasks.find((task) => task.taskId === pinnedTaskId) ?? newest;
  const viewingEarlier = selected !== undefined && selected !== newest;
  const workspace = useSessionDraftLink(session, selected?.taskId);
  const copy = useCallback((text: string) => void copyText(text), []);
  if (!session || !isOpenSession(session)) return null;

  const facts = focusFacts(model, snapshot.observations, selected);
  const code = selected?.draftCode ?? selected?.code ?? null;
  const copyable =
    selected?.kind === "programming-challenge"
      ? (code?.code ?? null)
      : (selected?.answer?.draft ?? null);

  return (
    <section
      className="live-focus"
      data-testid="focus-view"
      data-variant={variant}
      aria-label="Focus view"
    >
      <header className="live-focus-head">
        <span className="live-chip neutral">{model.barLabel}</span>
        {facts.locality && (
          <span className="live-chip green" data-testid="focus-locality">
            {facts.locality}
          </span>
        )}
        <span
          className={`live-chip ${facts.sourceHealth.ok ? "green" : "amber"}`}
          data-testid="focus-sources"
        >
          {facts.sourceHealth.text}
        </span>
        <span className="live-note" data-testid="focus-capture">
          {facts.capture
            ? `${facts.capture.sourceLabel} capture ${facts.capture.ageText}`
            : "No capture yet"}
        </span>
        <span className="live-chip neutral" data-testid="focus-verification">
          {facts.verification}
        </span>
      </header>
      {viewingEarlier && (
        <div className="live-banner earlier" role="status">
          <Icon name="history" />
          <span className="live-banner-text">
            Viewing an earlier task. Studio still tracks the newest one.
          </span>
          <button
            type="button"
            className="live-banner-action"
            onClick={() => presentation.pin(null)}
          >
            Back to now
          </button>
        </div>
      )}
      {selected ? (
        <>
          <TaskSelector
            tasks={tasks}
            selectedId={selected.taskId}
            onSelect={(taskId) =>
              presentation.pin(taskId === newest?.taskId ? null : taskId)
            }
          />
          <TaskPanel
            task={selected}
            number={tasks.indexOf(selected) + 1}
            session={session}
            policy={model.locality?.policy ?? null}
            onCopy={copy}
            showWorkspaceLink={false}
          />
          {code && (
            <details className="live-focus-code">
              <summary>Code</summary>
              <pre>{code.code}</pre>
            </details>
          )}
        </>
      ) : (
        <IdleState model={model} />
      )}
      <FocusControls
        snapshot={snapshot}
        actions={actions}
        facts={facts}
        paused={session.status === "paused"}
        copyable={copyable}
        onCopy={copy}
        workspace={workspace}
      />
      <PresentationSwitch where={variant} />
    </section>
  );
}
