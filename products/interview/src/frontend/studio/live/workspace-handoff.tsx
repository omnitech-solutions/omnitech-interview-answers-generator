// The hand-off from a session to its Workspace draft (plan #3 U8). A coding
// task's solution is written to a draft the session owns: Workspace id
// `active-session:<sessionId>`, artifact `coding:<taskId>`, provenance
// `session:<sessionId>`. This file is the one place a screen asks for the
// route to open it; the draft itself opens in the existing Workspace editor
// (session-draft-workspace.tsx), not in a second one.
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { useCallback, useMemo } from "react";
import { useStudio } from "../context";
import {
  parseRoute,
  routeHref,
  SESSION_WORKSPACE_PREFIX,
  type StudioNavigation,
} from "../use-studio-route";
import { draftFacts } from "./session-draft-facts";
import type { TaskView } from "./session-tasks";
import { useLiveSession } from "./use-live-session";

// The Workspace draft a session owns, by the key the backend wrote.
export type SessionDraftTarget = {
  workspaceId: string;
  artifactId: string;
  // The draft revision the session last wrote, when known.
  artifactRevision?: number;
};

export type SessionDraftLink = {
  target: SessionDraftTarget;
  // Opens the draft in the Workspace.
  open(): void;
};

// The Workspace id and artifact id the backend uses for a session's draft.
export const sessionDraftWorkspaceId = (sessionId: string): string =>
  `${SESSION_WORKSPACE_PREFIX}${sessionId}`;
export const sessionDraftArtifactId = (taskId: string): string =>
  `coding:${taskId}`;

// The task a session draft's artifact id names (`coding:<taskId>`), or null.
export const taskIdOfSessionDraft = (artifactId: string): string | null =>
  artifactId.startsWith("coding:") ? artifactId.slice("coding:".length) : null;
// The session a session Workspace id names, or null for any other id.
export const sessionIdOfWorkspace = (workspaceId: string): string | null =>
  workspaceId.startsWith(SESSION_WORKSPACE_PREFIX)
    ? workspaceId.slice(SESSION_WORKSPACE_PREFIX.length)
    : null;

// The draft the session has for a task. A written result means the draft
// exists. A held result means it exists too, unless the owner removed it (the
// session then never recreates it).
function targetOf(
  sessionId: string,
  task: TaskView,
): SessionDraftTarget | null {
  const facts = draftFacts(task);
  const exists =
    facts.written !== null ||
    (facts.held !== null && facts.held.reason !== "draft_removed");
  if (!exists) return null;
  return {
    workspaceId: sessionDraftWorkspaceId(sessionId),
    artifactId: sessionDraftArtifactId(task.taskId),
    ...(facts.written?.artifactRevision != null
      ? { artifactRevision: facts.written.artifactRevision }
      : {}),
  };
}

// Without the Studio shell around it (a test, a lone component) the route is
// still the address bar: write it and tell the route hook.
function openInAddressBar(next: StudioNavigation): void {
  const route = parseRoute(window.location);
  window.history.pushState(
    {},
    "",
    routeHref({
      base: route.base,
      view: next.view,
      rest: [],
      artifact: next.artifact ?? "main",
      workspace: next.workspace,
    }),
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// The link to open a task's session draft, or null when there is none to open
// (no session, or no draft for the task; without a task, the session's linked
// draft or the newest task's).
export function useSessionDraftLink(
  session: Pick<LiveSessionView, "id" | "workspaceDraft"> | null,
  taskId?: string,
): SessionDraftLink | null {
  const studio = useStudio();
  const { model } = useLiveSession();
  const sessionId = session?.id ?? null;
  const linked = session?.workspaceDraft ?? null;
  const tasks = model.tasks;

  const target = useMemo((): SessionDraftTarget | null => {
    if (!sessionId) return null;
    if (taskId) {
      const task = tasks.find((item) => item.taskId === taskId);
      return task ? targetOf(sessionId, task) : null;
    }
    if (linked) return linked;
    for (const task of [...tasks].reverse()) {
      const found = targetOf(sessionId, task);
      if (found) return found;
    }
    return null;
  }, [sessionId, taskId, linked, tasks]);

  const openRoute = studio?.openRoute;
  const open = useCallback(() => {
    if (!target) return;
    // [GUARD] Only a session's own Workspace id is written into the route; a
    // linked draft in the product's own workspace opens the ordinary way.
    const next: StudioNavigation = {
      view: "work",
      artifact: target.artifactId,
      ...(target.workspaceId.startsWith(SESSION_WORKSPACE_PREFIX)
        ? { workspace: target.workspaceId }
        : {}),
    };
    (openRoute ?? openInAddressBar)(next);
  }, [target, openRoute]);

  return useMemo(() => (target ? { target, open } : null), [target, open]);
}
