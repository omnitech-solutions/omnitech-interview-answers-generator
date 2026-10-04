# products/interview/src/backend/live-session/session-run.ts

_Source: `products/interview/src/backend/live-session/session-run.ts` (header-comment fallback)_

One held session's in-memory state and its replay through the neutral core.
A run exists only while this worker holds the session's lease at one fence;
a new claim (a restart, or a successor after expiry) builds a fresh run and
replays the stored observations from the start, so nothing but the database
outlives a fence. Replay is deterministic for the baseline policy: task ids
come from the policy's task key (named after the question's own segment), and
the database's dispatch dedup (session, task,
revision, action kind) is the safety net if it ever were not.

The core decides ordering, supersession, task identity and revisions; this
module only feeds it and never inspects utterance text. Screenshots are
stored by ingest and never interpreted here: a screen snapshot is only
remembered by id, and an owner's Analyze request (an `owner.input`
observation, ADR-0016) names the exact snapshots a task revision rests on.
That provenance travels with the revision (basedOn: spoken segment ids,
`snap/...` snapshot ids and `input/...` owner-input ids), so replay,
supersession, publication checks and the purge all see it; image
interpretation is refused in device-only.

Contents, in file order:
types      PendingOwnerInput, SessionRun, ActionSlot
slots      slotFor, allSlots, occupySlot, releaseSlot
run        createRun, keyOf, requestOf
restart    seedFromActions (what stored actions remember)
replay     replayObservations, noteSnapshot, queueOwnerInput
evidence   attachmentsFor, capturedFor
apply      processInOrder (utterances and owner inputs in observation
order), processOwnerInputs, processUtterances
progress   noteRecorded, handledThrough, nextPending, nextPendingCoding
cancel     cancelSupersededSlots
