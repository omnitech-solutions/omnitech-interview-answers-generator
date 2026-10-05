# products/interview/src/frontend/studio/live/overlay/code-canvas.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/code-canvas.tsx` (header-comment fallback)_

The live session's code draft as an editor canvas, like the Workspace's:
tabs Solution | Usage | Tests, a CodeMirror editor (the Workspace's language
support), copy per tab and for all, and a Run button that executes the three
fields in order through the same runner the Workspace uses (/api/v1/run-all).
The worker's own verification result is the first thing the Results panel
shows; Run re-runs what the person edited.

[SAFETY] The session's result is never overwritten while the person has
unsaved edits: a newer revision is offered in a bar (Switch / Keep mine).
Code is never logged and nothing leaves the page except the runner request.
