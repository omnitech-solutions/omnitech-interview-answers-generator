# products/interview/src/frontend/studio/live/session-draft-panel.tsx

_Source: `products/interview/src/frontend/studio/live/session-draft-panel.tsx` (header-comment fallback)_

What the Workspace shows above the editor when it is a session's private
draft: where it came from, whether the owner has edited it, the session's own
result for it (the three distinct states and its generated tests), the work
still running, and, when the session could not write a newer solution, that
solution as a suggestion the owner may take or dismiss.

Everything model-written (test names, code) renders as inert text
(rule:inert-draft-rendering). Nothing here sends or submits anything.
