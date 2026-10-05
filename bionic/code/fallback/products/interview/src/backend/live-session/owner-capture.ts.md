# products/interview/src/backend/live-session/owner-capture.ts

_Source: `products/interview/src/backend/live-session/owner-capture.ts` (header-comment fallback)_

Owner capture and analyze: the owner's own browser capture (a window, tab or
screen they picked, optionally cropped) analysed on press. One transaction
under the session row lock stores the image exactly as ingest stores a
companion screenshot (private artifact, sha256 and media metadata), writes a
`screen.snapshot` observation under the reserved owner-capture source id, and
then the `owner.input` analyze observation that names it. A request may carry
several images (a task's added context): every image gets its own snapshot,
one `owner.input` names them all, so the whole request is ONE revision and
is all-or-nothing (one bad image refuses it with nothing stored).
- the wire cannot produce the owner-capture source (ingest refuses it, and
a CHECK pairs it with stored screen snapshots);
- both rows are exempt from the capture caps and rate counters, and the
capture count is bounded by its own per-session cap;
- the image is accepted by magic bytes and header-parsed dimensions only;
every bad image or field is one undifferentiated invalid_input;
- the purge deletes the artifact like any session screenshot.
Nothing here logs; bytes, labels and hints never appear in an error.
