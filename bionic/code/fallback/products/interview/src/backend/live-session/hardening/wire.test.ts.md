# products/interview/src/backend/live-session/hardening/wire.test.ts

_Source: `products/interview/src/backend/live-session/hardening/wire.test.ts` (header-comment fallback)_

Hardening cases 1, 3, 4 and 10 (PB-0002 slice 3), driven by the fixture
companion through the REAL routes, credential check and stores:
1  reconnection with resend: a dropped connection (before the server and
after it, so the answer is lost), the same event ids resent, zero
duplicate observations and zero duplicate actions;
3  conflicting observations: same source and event id with different
content is refused event_conflict (409) and the stored row is unchanged;
4  permission revocation: the companion's source loss reaches a REAL
stream page and the Live view model shows "permission revoked", never
"listening";
10  the real-stream-page -> deriveLiveModel path the cases above rely on.
