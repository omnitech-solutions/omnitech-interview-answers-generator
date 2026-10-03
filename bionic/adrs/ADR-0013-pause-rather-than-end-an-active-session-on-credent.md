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
    rule: "Only the owner's session control, owner delete or the duration cap end a session; credential expiry and a companion's local stop only pause it, and the owner resumes."
    scope: session status machine, ingest and the capture companion
    handle: ADR-0013/pause-only-credential-stop
    provenance: authored
    retires: [ADR-0011/stop-authority]
---

# ADR-0013 — Pause rather than end an Active Session on credential expiry or companion stop

## Context

ADR-0011's governed rule `ADR-0011/stop-authority` says credential expiry or the companion's local stop ends capture. ADR-0012 changed this in prose: its Context amends that rule, and its Retention and Credential sections say expiry and a companion stop pause the session while only the owner, owner delete or the duration cap end it. The rule table and doctrine still list the ADR-0011 wording as live. The code follows ADR-0012: the session status machine lets credential expiry and the companion stop issue only pause, and lets only the owner's control resume.

The PB-0002 review-1 pass found two more gaps between ADR-0012 and the code. The `capability.report` ingest message, added in dev loop 4, writes an owner-level row that a session credential can overwrite. ADR-0012's description of what the purge keeps is also narrower than what the code keeps.

## Decision

1. **Stop authority.** Only the owner's session control, owner delete or the duration cap end a session. Credential expiry and a companion's local stop only pause it, and only the owner resumes it. This rule replaces `ADR-0011/stop-authority`, and it takes effect when this ADR is accepted.
2. **Capability report is advisory.** The companion's stored capability report is advisory only. Setup shows it as a non-blocking advisory with its age. The companion's own on-device check when it starts capture is the authority. The stored report never blocks Start, and no server decision depends on it.
3. **Draft purge.** The purge deletes a session-created Workspace draft only while it is still exactly what the session last published. It keeps every draft the owner has edited, and every draft that a saved answer revision or a revert record references. This replaces ADR-0012's narrower statement that only promoted or exported drafts survive the purge.

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
- **Why not:** an advisory keeps the useful signal and makes a forged report harmless.

## Consequences

**Positive:**
- The rule table, doctrine and code agree on who ends a session (OBJ-5).
- A forged capability report cannot block or permit a session start.

**Negative:**
- Whoever holds a session credential can, within the ingest caps: append observations while the session is active, from the sources fixed at start; pause the session and cancel its in-flight jobs (a heartbeat with `capturing: false`); refresh the contact time that the heartbeat-age pause reads; and post `capability.report`. The holder cannot resume, end or delete the session, read its content, or add sources. A thief can therefore interrupt a session but cannot extend capture past the owner's control. This is accepted by design.
- `capability.report` writes the owner-scoped `interview.companion_capabilities` row. That row outlives the session and the purge, and is removed only when the owner's membership is removed. ADR-0012's claim that the stolen-credential risk is append-only does not hold for this row. Decision 2 keeps that risk advisory. The row holds device states and a locale tag, never content.
- The purge leaves more owner-adopted drafts than ADR-0012 stated, so the Studio purge copy must describe Decision 3.

**Follow-on work:**
- An operator or council gate accepts or rejects this ADR. Until it is accepted, `ADR-0011/stop-authority` stays live in the rule table.
- If Setup ever needs a blocking device signal, that signal needs a device-bound or owner-signed channel, which requires a new ADR.

## References

- [[adrs/ADR-0011-host-the-active-session-processor-in-the-agent-worker]]
- [[adrs/ADR-0012-keep-active-session-data-private-to-the-actor-and]]
- [[objectives]]
- `products/interview/src/backend/live-session/core/status.ts` — status machine and permitted actors
- `products/interview/src/backend/live-session/ingest.ts` — heartbeat pause and `capability.report`
- `products/interview/src/backend/live-session/companion-capability.ts` — the owner-scoped capability row
- `products/interview/src/backend/live-session/session-drafts.ts` — the draft purger
- `products/interview/src/frontend/studio/live/setup-view.tsx` — advisory, non-blocking capability display
