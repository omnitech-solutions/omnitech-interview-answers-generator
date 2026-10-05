# products/interview/src/backend/live-session/canonical-json.ts

_Source: `products/interview/src/backend/live-session/canonical-json.ts` (header-comment fallback)_

JSON with object keys in sorted order at every depth, so two values compare
equal whatever order their keys were written in. (The matrix hash in
context-snapshot.ts has its own fixed byte format and must not use this.)
