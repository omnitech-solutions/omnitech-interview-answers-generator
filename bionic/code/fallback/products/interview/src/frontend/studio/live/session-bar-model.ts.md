# products/interview/src/frontend/studio/live/session-bar-model.ts

_Source: `products/interview/src/frontend/studio/live/session-bar-model.ts` (header-comment fallback)_

What the session bar shows, as pure functions of the view model: the state
dot and label, one chip per selected source, and the fixed sentences for
command failures. No React, no fetching. Every claim here is checked against
the server record: "receiving" is never said without companion contact, and
the companion is never called connected before the server has seen it.
