# products/interview/src/frontend/studio/live/focus-controls.tsx

_Source: `products/interview/src/frontend/studio/live/focus-controls.tsx` (header-comment fallback)_

The Focus controls: Analyze latest capture, a typed follow-up, Copy, Open in
Workspace, Pause or Resume, and End. Each calls a store action; none holds
session logic. A server without the owner-input route answers "unavailable",
which disables the two input controls with a clear note instead of failing.
