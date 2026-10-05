# products/interview/src/backend/live-session/capture-request.ts

_Source: `products/interview/src/backend/live-session/capture-request.ts` (header-comment fallback)_

Capture now: the owner's one-shot request that the native companion capture
ONCE (the focused window, a masked region, or the display) and that Studio
analyse what comes back. The request lives on the session row (one pending
request per session; a newer one replaces it), and reaches the companion only
as `control.capture` on an acknowledgement it already receives.
- the companion credential can never create an analyze on its own: a
snapshot is analysed only when it names the exact id of THIS session's
pending, unexpired request, and the analysis is created in the same
transaction that stores the snapshot (fulfilCaptureRequest);
- a snapshot that NAMES a request (requestId) which is not this session's
pending, unexpired one (expired, replaced, failed, already captured,
unknown) is refused before anything is stored (checkSnapshotRequest);
a snapshot with no requestId is a plain snapshot, unchanged;
- the request reaches only a companion that declared support for it
(negotiation.ts); one that did not is refused with
companion_update_required, and the owner's request is bound to the
companion's screen selection so a mask is never reused across a change;
- the companion reports it could not capture (failCaptureRequest), and the
owner's state turns "failed" at once instead of waiting for expiry;
- a device-only session refuses early with the same reason the dispatcher
would give (vision_device_only): nothing is requested, nothing captured;
- the request is session content and the purge clears it.
Nothing here logs; regions, hints and ids never appear in an error.
