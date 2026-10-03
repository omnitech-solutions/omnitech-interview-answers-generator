# products/interview/src/backend/live-session/index.ts

_Source: `products/interview/src/backend/live-session/index.ts` (header-comment fallback)_

The Active Session repository layer: the one public entrypoint of the
persistence side of the live session (the neutral core is core/index.ts and
imports none of this). Everything here opens an actor-scoped transaction for
the session owner, except the three narrow cross-tenant settings, each set by
one owning file: the worker claim (session-claim.ts), the credential lookup
(credential-lookup.ts) and the purge delete (session-purge.ts).
