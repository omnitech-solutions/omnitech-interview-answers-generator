# products/interview/src/backend/live-session/screenshot-loader.ts

_Source: `products/interview/src/backend/live-session/screenshot-loader.ts` (header-comment fallback)_

The screenshot loader (ADR-0016 Decision 3): resolves an attachment that
names one stored screen snapshot to its verified bytes, for the worker's
agent port to stage. It is the product side of the port's
`attachmentSource`:
- input is observation ids only (session, source and event id), never a
path, URL or byte string;
- the snapshot observation is joined to the OWNER's own session, which
must still be active, in the owner's tenant-and-actor scope;
- the media type is re-detected from the loaded bytes and must match what
the observation and the artifact recorded;
- the stored sha256 digest is checked against the bytes;
- bytes and decoded dimensions are capped, the dimensions read from the
image header alone (no decode).
Nothing here writes anything (the port stages the bytes in its private
directory), logs, or puts an id or any pixel into an error: failures are a
typed code.
