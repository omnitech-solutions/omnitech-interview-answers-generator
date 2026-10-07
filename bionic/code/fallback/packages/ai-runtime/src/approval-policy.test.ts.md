# packages/ai-runtime/src/approval-policy.test.ts

_Source: `packages/ai-runtime/src/approval-policy.test.ts` (header-comment fallback)_

AN-ERR-01: the Claude runtime maps any approval policy other than "never" to
permissionMode "default", which asks a person before an unlisted tool runs.
A worker has nobody to ask, so such a profile would hang unless the runtime
supplies a permission callback (canUseTool). Codex's adapter denies
interactive requests itself, but the profiles are shared, so one rule holds.
