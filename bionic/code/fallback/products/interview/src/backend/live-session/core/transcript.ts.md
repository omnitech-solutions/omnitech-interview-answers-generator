# products/interview/src/backend/live-session/core/transcript.ts

_Source: `products/interview/src/backend/live-session/core/transcript.ts` (header-comment fallback)_

Effective transcript view and supersession. A transcript.final carrying
`supersedes` replaces the earlier segment in the effective view; work built
on the superseded segment is marked stale elsewhere, never edited. The text
is stored only to be handed to the policy port and is never inspected here.
