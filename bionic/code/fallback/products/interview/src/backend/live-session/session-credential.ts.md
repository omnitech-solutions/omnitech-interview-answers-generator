# products/interview/src/backend/live-session/session-credential.ts

_Source: `products/interview/src/backend/live-session/session-credential.ts` (header-comment fallback)_

The ingest credential helper (rule:credential-storage, rule:credential-
strength, rule:credential-lifetime-and-renewal). The plaintext exists only in
the value returned to the owner at start or renewal; the database stores its
SHA-256 hash and expiry. Nothing here logs, and no error carries a
credential, so a canary credential never surfaces in a message.
