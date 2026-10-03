# products/interview/src/backend/live-session/processor-locality.test.ts

_Source: `products/interview/src/backend/live-session/processor-locality.test.ts` (header-comment fallback)_

Device-only locality through the real processor and the REAL gateway with
spy provider adapters (rule:device-only-enforced-twice,
rule:unlisted-stage-refused): a device-only session reaches only a profile
the environment declared device-local; a remote or undeclared profile is
refused with no call to any adapter and no fallback to the remote profile,
and the refusal is traced by id and code only. A permitted-remote session
uses the fast profile as before.
