# products/interview/src/frontend/studio/live/session-results.ts

_Source: `products/interview/src/frontend/studio/live/session-results.ts` (header-comment fallback)_

Defensive parsers for the two kinds of session content the stream carries as
`unknown`: an action's published result and an observation's content. The
shapes mirror what the backend publishes (assist-stage.ts, coding-path.ts,
session-drafts.ts, escalation.ts) but are read here with lenient schemas:
extra fields are ignored, and anything that does not parse is null. A screen
shows nothing rather than a guess (rule:inert-draft-rendering: whatever these
return is plain text for the screen to render inertly).
