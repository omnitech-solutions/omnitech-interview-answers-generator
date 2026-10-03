# products/interview/src/backend/live-session/session-purge.ts

_Source: `products/interview/src/backend/live-session/session-purge.ts` (header-comment fallback)_

The Active Session purge. This is the one file that sets app.session_purge
(rule:purge-delete-setting; scripts/tenant-context-boundary.test.ts). The
database deletes session observations, actions, the session row and session
screenshot artifacts (with their payloads) only while the setting is on, the
owner matches the actor and, for artifacts, the type is the session type.

One idempotent purge (rule:complete-purge-except-retained-drafts):
1. mark the session purging (refuses ingest and dispatch, revokes the
credential) and request cancellation of its jobs;
2. wait, bounded, for the named jobs to be terminal;
3. in ONE transaction under the purge setting delete observations, the
screenshot artifacts and payloads, actions, the session's jobs with
their events and artifacts and every payload those jobs referenced (the
references are collected in the transaction that deletes the job rows),
unchanged session-created drafts not named by a revision or revert
(through SessionDraftPurger), clear the links,
snapshot and credential, then run the FINAL CHECK;
4. only a passing final check sets the tombstone (ended, purged_at,
purge_outcome, counts; the shown-draft count is preserved).
A crash resumes at the next sweep; a failing final check never tombstones.

The relay rows of the on-device model (ADR-0012 Locality by stage) are out of
scope for this loop: no relay rows are created yet, so none are deleted here.
The purge runs as the session owner whether or not the owner is still a
tenant member, so a removed member's sessions are still purged.
