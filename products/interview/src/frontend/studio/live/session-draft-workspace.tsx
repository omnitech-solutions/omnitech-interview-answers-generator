// A session's private draft in the EXISTING Workspace editor (plan #3 U8).
// The route names the draft (`work?artifact=coding:<task>&workspace=
// active-session:<session>`); this component opens it in WorkspaceView, which
// already owns editing, optimistic-revision saves, running tests and the
// assistant binding, and adds what only a session draft has: where it came
// from, its results, and the suggestions the session could not apply.
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { useEffect } from "react";
import type { StudioActions } from "../config/commands";
import {
  type SessionDraftState,
  type WorkspaceAssistant,
  WorkspaceView,
} from "../workspace/workspace-view";
import { draftFacts } from "./session-draft-facts";
import { SessionDraftPanel } from "./session-draft-panel";
import { useLiveSession } from "./use-live-session";
import { useSessionTarget } from "./use-session-target";
import {
  sessionIdOfWorkspace,
  taskIdOfSessionDraft,
} from "./workspace-handoff";

export function SessionDraftWorkspace({
  assistant,
  studio,
}: {
  assistant: WorkspaceAssistant;
  studio: StudioActions;
}) {
  const sessionId = sessionIdOfWorkspace(assistant.workspaceId);
  const taskId = taskIdOfSessionDraft(assistant.artifactId);
  const { snapshot, actions } = useLiveSession();
  const session = snapshot.session?.id === sessionId ? snapshot.session : null;

  // A finished session opened by address (after a reload, say) is read so its
  // results show; a running session is never displaced by this lookup.
  useEffect(() => {
    if (sessionId && snapshot.hydration === "ready" && !session)
      void actions.openSession(sessionId);
  }, [sessionId, snapshot.hydration, session, actions]);

  return (
    <WorkspaceView
      assistant={assistant}
      sessionDraft={(state) => (
        <Connected
          state={state}
          sessionId={sessionId ?? ""}
          taskId={taskId}
          session={session}
          onBack={() => studio.go("live", sessionId ? [sessionId] : [])}
        />
      )}
    />
  );
}

function Connected(props: {
  state: SessionDraftState;
  sessionId: string;
  taskId: string | null;
  session: LiveSessionView | null;
  onBack(): void;
}) {
  return props.session ? (
    <WithTarget {...props} session={props.session} />
  ) : (
    <Panel {...props} target="session not loaded" />
  );
}

function WithTarget(
  props: Parameters<typeof Connected>[0] & { session: LiveSessionView },
) {
  const target = useSessionTarget(props.session);
  return <Panel {...props} target={target} />;
}

function Panel({
  state,
  sessionId,
  taskId,
  session,
  target,
  onBack,
}: Parameters<typeof Connected>[0] & { target: string }) {
  const { model } = useLiveSession();
  const task = session
    ? (model.tasks.find((item) => item.taskId === taskId) ?? null)
    : null;
  return (
    <SessionDraftPanel
      state={state}
      sessionId={sessionId}
      facts={draftFacts(task)}
      target={target}
      resultsKnown={session !== null}
      purged={session?.purged === true}
      onBack={onBack}
    />
  );
}
