# products/interview/src/frontend/studio/live/overlay/panels/use-engine.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/use-engine.ts` (header-comment fallback)_

The native engine (window.studioHost.engine): hands-free listening and
watching done by the shell. Studio decides: this starts it for the open
session when Auto begins, stops it when Auto ends, and holds and resumes it
with the session. The shell reports typed, content-free state. The pairing
credential never reaches this page.

[SAFETY] While the engine is starting or listening, the page does NOT start
the browser's speech recogniser: only one listener posts transcripts. With no
engine (or one that refused to start) the browser recogniser is the fallback.
