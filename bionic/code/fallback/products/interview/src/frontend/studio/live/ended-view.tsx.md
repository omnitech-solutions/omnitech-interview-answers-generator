# products/interview/src/frontend/studio/live/ended-view.tsx

_Source: `products/interview/src/frontend/studio/live/ended-view.tsx` (header-comment fallback)_

The ended view: what a finished session left behind, truthfully.
- Ending revokes the credential and cancels running work (ADR-0012
rule:credential-revocation; ADR-0011 rule:pause-end-suppression); the view makes no "nothing is running" claim, as
the worker may still be finishing a cancelled job.
- "Nothing was submitted or sent for you": no route of this product
operates an external interview interface, and the session sends nothing.
- A session being deleted, or deleted, holds no content here: the store
clears observations and actions while purging, and this view then shows
only the tombstone's content-free facts (rule:complete-purge-except-retained-drafts,
rule:tombstone-keeps-hint-count).
