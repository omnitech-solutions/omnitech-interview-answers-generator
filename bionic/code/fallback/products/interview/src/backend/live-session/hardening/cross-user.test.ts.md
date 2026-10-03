# products/interview/src/backend/live-session/hardening/cross-user.test.ts

_Source: `products/interview/src/backend/live-session/hardening/cross-user.test.ts` (header-comment fallback)_

Hardening case 5 (PB-0002 slice 3): a same-tenant member who is NOT the
owner reaches nothing of another member's Active Session on any read path.
Owner A's session is built through the real routes with a fixture companion
(transcripts, a screenshot, a capability report), the real processor and a
private job; member B and member C then try every path as themselves. Each
negative has a positive control: A reads the same thing and gets content.
