// The strip under the toolbar: what the window is doing now (one row of the
// table in strip-model.ts) and a chip per task to choose which one is on show.
// The chips share the transcript's selection, so choosing in either place shows
// the same task.
import { Icon } from "../../../icon";
import { taskLabel } from "../../shared/task-target";
import { failureNote } from "../overlay-footer";
import { taskChips } from "./panel-model";
import type { PanelSession } from "./panel-views";
import {
  finishedWork,
  type StripActionId,
  type StripState,
  stripState,
} from "./strip-model";
import { phaseLabel } from "./toolbar-config";
import { useElapsed } from "./use-elapsed";

type Strip = {
  state: StripState | null;
  // What the native engine needs from the owner (refusal reason, hint, lost or
  // denied microphone); null when nothing.
  engine: string | null;

  chips: ReturnType<typeof taskChips>;
};

// What the strip shows, or null when there is nothing to say and fewer than two
// tasks to choose between.
export function useStrip(s: PanelSession): Strip | null {
  const stage = phaseLabel(s.phase, s.model.activity.key);
  const seconds = useElapsed(stage !== null);
  const tasks = s.model.tasks;
  const newest = tasks[tasks.length - 1];
  const label = taskLabel(tasks.length);
  const state = stripState({
    paused: s.paused,
    busy: stage ? { label: stage, seconds } : null,
    newest: newest ? { label, answered: newest.answer !== null } : null,
    auto: {
      line: s.auto.line,
      watching: s.auto.watching,
      intervalSec: s.auto.limits.intervalSec,
    },
    finished: finishedWork(newest, label, s.model.serverNowMs),
  });
  const chips = taskChips(tasks, s.selected?.taskId);
  const engine = s.engineNeeds;
  return state || engine || chips.length > 1 ? { state, engine, chips } : null;
}

export function StatusStrip({ s, strip }: { s: PanelSession; strip: Strip }) {
  const { state, engine, chips } = strip;
  const act: Record<StripActionId, () => void> = {
    stop: () => void s.stop(),
    resume: () =>
      void s.actions.resume().then((result) => {
        if (!result.ok) s.notify(failureNote(result.code, result.reason));
      }),
  };
  return (
    <div
      className="pn-strip"
      data-testid="pn-strip"
      data-state={state?.id}
      data-tone={state?.tone}
    >
      {state && (
        <>
          <span className="pn-strip-main" role="status">
            {state.busy ? (
              <span className="pn-spinner" aria-hidden="true" />
            ) : (
              state.icon && <Icon name={state.icon} filled />
            )}
            {state.label}
          </span>
          {state.sub && <span className="pn-strip-sub">{state.sub}</span>}
        </>
      )}
      {engine && (
        <span
          className="pn-strip-sub pn-strip-engine"
          role="status"
          data-testid="pn-engine-line"
        >
          <Icon name="warning" />
          {engine}
        </span>
      )}
      <span className="pn-fill" />
      {chips.length > 1 && (
        <div className="pn-task-chips" role="group" aria-label="Tasks">
          {chips.map((chip) => (
            <button
              key={chip.taskId}
              type="button"
              className="pn-task-chip"
              aria-pressed={chip.selected}
              title={`Show ${chip.label}`}
              onClick={() => s.select(chip.newest ? null : chip.taskId)}
            >
              {chip.text}
            </button>
          ))}
        </div>
      )}
      {state?.action && (
        <button
          type="button"
          className="pn-mini-button"
          data-action={state.action.id}
          title={state.action.title}
          onClick={act[state.action.id]}
        >
          {state.action.id === "stop" && <Icon name="stop_circle" />}
          {state.action.label}
        </button>
      )}
    </div>
  );
}
