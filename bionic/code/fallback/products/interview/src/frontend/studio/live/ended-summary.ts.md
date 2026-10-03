# products/interview/src/frontend/studio/live/ended-summary.ts

_Source: `products/interview/src/frontend/studio/live/ended-summary.ts` (header-comment fallback)_

What the ended view says, derived from the session record and the results the
store holds. Pure: no fetching, no React. Every sentence here is a claim the
product makes about a finished session, so each one rests on a rule:
- nothing was promoted:       ADR-0011 rule:no-promotion
- retention modes and purge:  ADR-0012/retention-modes, complete-session-purge
- the hint count:             ADR-0012/tombstone-keeps-hint-count
Answer drafts and code are session content: they are returned as plain text
for the view to render inertly (rule:inert-draft-rendering).
