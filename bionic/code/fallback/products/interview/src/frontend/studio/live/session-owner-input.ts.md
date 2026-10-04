# products/interview/src/frontend/studio/live/session-owner-input.ts

_Source: `products/interview/src/frontend/studio/live/session-owner-input.ts` (header-comment fallback)_

The browser side of owner input (ADR-0016): "Analyze latest capture" and a
typed follow-up, both sent to the one owner-input route. The request names
the newest screen snapshot by its observation ids (frozen at click time), and
a follow-up names the task revision the owner last saw; it carries no bytes,
no identity and no path. The text is passed through to the route only: it is
never logged, stored or echoed here.
