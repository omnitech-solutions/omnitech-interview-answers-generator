// The hand-off from a session to its Workspace draft (plan #3 U8). A coding
// task's solution is written to a draft the session owns: Workspace id
// `active-session:<sessionId>`, artifact `coding:<taskId>`, provenance
// `session:<sessionId>`. This file is the one place a screen asks for the
// route to open it.
import type { LiveSessionView } from "@omnitech/interview-contracts";

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
  `active-session:${sessionId}`;
export const sessionDraftArtifactId = (taskId: string): string =>
  `coding:${taskId}`;

// The link to open a task's session draft, or null when there is none to open
// (no session, or no task given and no linked draft).
//
// STUB (plan #3 U3): returns null. The Workspace hand-off unit implements it
// (the Workspace view assumes the fixed workspace id "interview", so opening a
// session draft needs a bounded override there) and keeps this signature.
export function useSessionDraftLink(
  _session: Pick<LiveSessionView, "id" | "workspaceDraft"> | null,
  _taskId?: string,
): SessionDraftLink | null {
  return null;
}
