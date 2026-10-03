# products/interview/src/backend/live-session/core/status.ts

_Source: `products/interview/src/backend/live-session/core/status.ts` (header-comment fallback)_

Session status machine and stop authority (rule:owner-starts-and-resumes,
rule:pause-only-credential-stop, rule:owner-or-cap-ends). Expiry and a
companion stop pause; owner control, owner delete or duration cap end.
Pure; persistence enforces it.
