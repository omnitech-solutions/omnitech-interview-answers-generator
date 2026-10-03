# products/interview/src/backend/live-session/processor-rebuild-deferral.test.ts

_Source: `products/interview/src/backend/live-session/processor-rebuild-deferral.test.ts` (header-comment fallback)_

Review round 5: a deferred topic ("put a pin in it") must not stop the
handled-through marker, or a LATER statement the live run ignored is judged
again after a rebuild and can open a spurious revision. A rebuilt run
(handover, or pause then resume) matches the live run: same drafts, same
task revisions.
