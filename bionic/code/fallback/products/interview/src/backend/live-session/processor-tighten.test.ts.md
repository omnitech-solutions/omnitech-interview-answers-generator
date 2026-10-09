# products/interview/src/backend/live-session/processor-tighten.test.ts

_Source: `products/interview/src/backend/live-session/processor-tighten.test.ts` (header-comment fallback)_

Device-only is enforced INSIDE a running dispatch (S5-2): a session tightened
to device-only while its coding dispatch is between two engine calls sends
no further remote request and creates no agent job; the standing is re-read
before every call and before an escalation job is requested.
