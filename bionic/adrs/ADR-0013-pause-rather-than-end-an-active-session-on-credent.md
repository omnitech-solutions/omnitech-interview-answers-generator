---
id: ADR-0013
title: Pause rather than end an Active Session on credential expiry or companion stop
status: Proposed
date: 2026-10-03
proposed_date: 2026-10-03
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0011, ADR-0012]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, privacy, credential, interview]
related_briefs: []
related_research: []
governs:
  - domain: active-session
    rule: "Only the owner's session control starts or resumes a session."
    scope: session status machine and capture companion
    handle: ADR-0013/owner-starts-and-resumes
    provenance: authored
    retires: [ADR-0011/stop-authority]
  - domain: active-session
    rule: "An expired, revoked or missing credential, a heartbeat reporting `capturing: false`, or silence past the heartbeat limit after prior contact pauses an active session and never ends it."
    scope: session status machine, ingest and the capture companion
    handle: ADR-0013/pause-only-credential-stop
    provenance: authored
    retires: [ADR-0011/stop-authority]
  - domain: active-session
    rule: "Only the owner's session control, an owner delete or the duration cap ends a session."
    scope: session status machine and purge sweep
    handle: ADR-0013/owner-or-cap-ends
    provenance: authored
    retires: [ADR-0011/stop-authority]
  - domain: active-session
    rule: "The owner's local stop on the capture companion stops capture and drops its buffers without waiting for Studio; any farewell call is best effort."
    scope: capture companion
    handle: ADR-0013/offline-local-stop
    provenance: authored
  - domain: active-session
    rule: "A Studio outage alone never stops capture on the capture companion."
    scope: capture companion
    handle: ADR-0013/outage-never-stops-capture
    provenance: authored
  - domain: active-session
    rule: "The stored companion capability report is advisory: it never blocks a session start and no server decision reads it."
    scope: Studio Setup and the companion capability row
    handle: ADR-0013/advisory-capability-report
    provenance: authored
  - domain: active-session-privacy
    rule: "The purge deletes a session-created draft only while it is unchanged since the session last published it and no saved answer revision or revert record names it; retained drafts may contain session content."
    scope: session draft purger
    handle: ADR-0013/purge-keeps-adopted-drafts
    provenance: authored
  - domain: active-session-privacy
    rule: "A session purge deletes its observations, actions, jobs, payloads, relay rows and other session records, with retained Workspace drafts that may contain captured session content as the explicit exception."
    scope: session purge and Studio retention disclosure
    handle: ADR-0013/complete-purge-except-retained-drafts
    provenance: authored
    retires: [ADR-0012/complete-session-purge]
---

# ADR-0013 — Pause rather than end an Active Session on credential expiry or companion stop

## Context

ADR-0011's governed rule `ADR-0011/stop-authority` says credential expiry or the companion's stop ends capture. ADR-0012 changed this in prose: its Retention and Credential sections say expiry and a companion stop pause the session while only the owner, an owner delete or the duration cap end it. The rule table and doctrine still list the ADR-0011 wording as live. The code follows ADR-0012.

The first review of promptbook PB-0002 found two more gaps. The `capability.report` ingest message writes an owner-scoped row that a session credential can overwrite, which breaks ADR-0012's claim that a stolen credential can only append. ADR-0012's account of what the purge keeps is also narrower than what the code keeps.

**Terms.** A dead credential is one that is expired, revoked or missing. A companion stop is what the server sees when a heartbeat reports `capturing: false` or, after prior contact, no heartbeat arrives within the heartbeat limit (two minutes, `HEARTBEAT_STALE_MS`). The owner's local stop first stops capture and clears buffers on the device, then may send a single best-effort farewell to Studio. The farewell can pause the session immediately; otherwise a silence pause requires prior heartbeat contact and a later reconciliation. The owner's session control is the Studio control acting as the session owner. A companion run is one pairing of the companion with a session credential.

**Statements this ADR replaces.** ADR-0011 Identity says "A session that outlives its credential ends capture visibly until renewal exists"; under this ADR that session pauses instead. ADR-0011 Control and scope, "Only the authenticated user's session control starts, pauses or stops capture", is replaced by Decision 1, and its "the companion stops locally while Studio is unavailable" is narrowed by Decision 2. ADR-0012 Credential, "a stolen credential can only append observations", and its "append-only" risk note are replaced by the Consequences below. ADR-0012 Retention, "A draft the owner promoted or exported to a Document is outside the purge", is replaced by Decision 4. ADR-0011/credential-ingest-scope is clarified: `capability.report` is a content-free ingest message that may write only the owner's advisory row.

## Decision

1. **Stop authority.** Only the owner's session control starts or resumes a session, and it can also pause an active session. A dead credential or a companion stop pauses an active session and never ends it. Only the owner's session control, an owner delete or the duration cap ends a session. The purge sweep starts a purge only for an ended session; an owner delete starts one at any status. The first three governed rules replace `ADR-0011/stop-authority` on acceptance.
2. **Offline local stop.** The owner's local stop on the companion stops capture and drops its buffers before any network request. It then attempts a best-effort farewell; success can pause the session immediately, and failure cannot restart capture. An outage alone does not stop local capture: the companion keeps capturing within its bounded in-memory buffer and resends. After prior heartbeat contact, a server reconciliation past the heartbeat limit pauses the session; the companion learns of that pause on its next successful contact and stops capturing until the owner resumes. Studio has no remote stop for an unreachable companion. The companion run ends when its credential is refused; capture resumes only after the owner renews the credential, pairs a new companion run and resumes in Studio.
3. **Capability report is advisory.** The companion's stored capability report is advisory only. Every Studio surface that shows it labels it advisory, and Setup also shows its age. The companion's on-device check when it starts capture decides whether capture can start. The stored report never blocks Start, and no server decision reads it.
4. **Draft purge and retention exception.** The purge deletes a session-created Workspace draft only while it is unchanged since the session last published it, and no saved answer revision or revert record names it. Every owner edit changes the draft, so the purge keeps every draft the owner edited. Studio offers no promote or export action for a session draft; editing it, saving an answer revision or recording a revert preserves it. A kept draft can still contain the captured question and generated answer. It survives the session's retention mode and owner deletion until the owner separately deletes it in Workspace. This is an explicit exception to `ADR-0012/complete-session-purge`, which the governed `complete-purge-except-retained-drafts` rule replaces on acceptance; the purge still removes the session's observations, actions, jobs, payloads, relay rows and other session records. Studio must disclose the exception before an owner deletes a session. This also replaces ADR-0012's statement about promoted or exported drafts.

## Alternatives Considered

### Option A — Keep ADR-0011's wording: expiry or a companion stop ends the session
- **Pros:** fewer states, and capture never resumes after a lapse.
- **Cons:** a crashed companion or an expired credential would end a live interview and, under delete at end, purge it; it contradicts ADR-0012's credential lifetime and renewal rules.
- **Why not:** the owner must not lose a session to an event outside their control.

### Option B — Let the session credential resume, or bind it to a device
- **Pros:** the companion could recover without owner action.
- **Cons:** a stolen credential could restart capture; ADR-0012 rules out device binding.
- **Why not:** resume stays an owner decision taken in Studio.

### Option C — Keep the capability report blocking, or delete it with the session
- **Pros:** Setup could refuse a device-only start early, or the row would not outlive its session.
- **Cons:** a blocking report lets anyone holding a session credential block or unblock the owner's later Setup. A per-session report is gone before the next session's Setup, because the companion has no channel to Studio before pairing.
- **Why not:** an advisory keeps the useful signal and limits a forged report to a misleading notice that blocks nothing.

### Option D — Purge every session-created draft, or move adopted drafts out of the session workspace
- **Pros:** the purge stays as simple as ADR-0012 stated; the owner's drafts would not share a workspace with session drafts.
- **Cons:** deleting an edited draft destroys the owner's work; moving drafts needs a new adoption action and a migration.
- **Why not:** the revision check already separates the owner's work from the session's, with no new action.

## Consequences

**Positive:**
- Once the derived docs are regenerated, the rule table, doctrine and code will agree on who starts, pauses and ends a session (OBJ-5).
- A forged capability report cannot block or permit a session start.

**Negative:**
- Anyone holding a stolen session credential can, within the ingest caps:
  - append observations while the session is active, with content only from the sources fixed at start;
  - use up the session's observation and screenshot caps, after which only a new session accepts more;
  - send fabricated observations, which the processor treats as untrusted input (ADR-0012);
  - pause the session and cancel its in-flight jobs, with a heartbeat reporting `capturing: false`;
  - send heartbeats that prevent the silence pause;
  - post `capability.report`.
- The holder cannot start, resume, end or delete the session, or add sources. The holder cannot read session content: a resend acknowledgement confirms only that an identical observation is already stored. The holder can interrupt a session or keep its server status active with heartbeats until the owner pauses or ends it or the duration cap expires. A remote pause or end suppresses ingest and dispatch; an unreachable companion cannot be stopped remotely. The owner can renew the credential, which revokes the stolen one, and resume. This replaces ADR-0012's statement that the risk is append-only, and the risk is accepted by design.
- `capability.report` writes the owner-scoped `interview.companion_capabilities` row. The row holds device states and a locale tag, not a session id or captured content; only the owner can read it. It outlives the session and the purge and is removed only when the owner's membership is removed; the owner cannot clear it, and the next accepted report replaces it. A forged report can mislead the advisory that Studio shows, now and in later sessions; it blocks and permits nothing.
- A kept draft holds the session's restated question and generated answer and follows no session retention mode. The owner deletes it in Workspace; session deletion alone does not erase it.
- After prior heartbeat contact, a network outage longer than the heartbeat limit pauses the session when the server next reconciles it, and the owner must resume it. With no prior heartbeat or reconciliation, silence alone does not yet change the status.

**Follow-on work:**
- On acceptance: regenerate the rule table and doctrine; repoint every `rule:stop-authority` and `rule:complete-session-purge` citation to the ADR-0013 handle for its obligation; correct the Studio purge copy to disclose retained drafts before deletion (and remove promote or export wording), and correct the comment in `session-purge.ts` about the draft purger.
- Add a purge test for a draft that a revert record names.
- Deferred, with the risk accepted: a tighter locale shape for the capability report, and a per-credential rate bound ahead of the session row lock. A blocking device signal needs a device-bound or owner-signed channel and a new ADR.

## References

- [[adrs/ADR-0011-host-the-active-session-processor-in-the-agent-worker]]
- [[adrs/ADR-0012-keep-active-session-data-private-to-the-actor-and]]
- [[objectives]]
- `products/interview/src/backend/live-session/core/status.ts` — status machine and permitted actors
- `products/interview/src/backend/live-session/status-transition.ts` — expiry, revocation and silence pause; the cap ends
- `products/interview/src/backend/live-session/ingest.ts` — heartbeat pause and `capability.report`
- `products/interview/src/backend/live-session/companion-capability.ts` — the owner-scoped capability row
- `products/interview/src/backend/live-session/session-drafts.ts` — the draft purger
- `products/interview/src/frontend/studio/live/setup-view.tsx` — advisory, non-blocking capability display
- `apps/capture-companion/src/local-stop.ts` — offline local stop
