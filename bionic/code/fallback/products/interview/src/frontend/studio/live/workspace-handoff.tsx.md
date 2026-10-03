# products/interview/src/frontend/studio/live/workspace-handoff.tsx

_Source: `products/interview/src/frontend/studio/live/workspace-handoff.tsx` (header-comment fallback)_

The hand-off from a session to its Workspace draft (plan #3 U8). A coding
task's solution is written to a draft the session owns: Workspace id
`active-session:<sessionId>`, artifact `coding:<taskId>`, provenance
`session:<sessionId>`. This file is the one place a screen asks for the
route to open it; the draft itself opens in the existing Workspace editor
(session-draft-workspace.tsx), not in a second one.
