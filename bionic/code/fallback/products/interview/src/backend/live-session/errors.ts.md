# products/interview/src/backend/live-session/errors.ts

_Source: `products/interview/src/backend/live-session/errors.ts` (header-comment fallback)_

Content-free errors for the Active Session repository layer. Every message is
a fixed string chosen by the code, so no id, credential, text or other
session content can ride along in an error (rule:id-only-traces,
rule:credential-storage). Callers branch on `code`.
