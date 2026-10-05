# products/interview/src/backend/live-session/owner-capture.test.ts

_Source: `products/interview/src/backend/live-session/owner-capture.test.ts` (header-comment fallback)_

Owner capture and analyze on a disposable PostgreSQL as the member role
(requires Docker, like the other session suites): the owner's browser image
is stored like a companion screenshot under the reserved owner-capture
source, analysed by an `owner.input` in one transaction, deduped on the
request id, exempt from the capture caps, refused by the wire, and deleted
by the purge. Also the route (multipart) and the shared hint fields of the
typed follow-up.
