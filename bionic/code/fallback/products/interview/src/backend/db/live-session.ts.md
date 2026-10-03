# products/interview/src/backend/db/live-session.ts

_Source: `products/interview/src/backend/db/live-session.ts` (header-comment fallback)_

Active Session persistence (ADR-0011, ADR-0012). Tables are owned by
Interview and carry tenant and owner ids under forced row security that
binds both (rule:actor-private-session-rows); every child references its
session by tenant, owner and session id (rule:composite-owner-references).
Triggers, the claim view, the credential-lookup and purge settings and the
session artifact policies are hand-appended to the migration, as in
Documents; this file declares the columns, keys and policies they sit on.
