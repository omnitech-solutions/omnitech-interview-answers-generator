# products/interview/src/frontend/studio/live/session-draft-workspace.tsx

_Source: `products/interview/src/frontend/studio/live/session-draft-workspace.tsx` (header-comment fallback)_

A session's private draft in the EXISTING Workspace editor (plan #3 U8).
The route names the draft (`work?artifact=coding:<task>&workspace=
active-session:<session>`); this component opens it in WorkspaceView, which
already owns editing, optimistic-revision saves, running tests and the
assistant binding, and adds what only a session draft has: where it came
from, its results, and the suggestions the session could not apply.
