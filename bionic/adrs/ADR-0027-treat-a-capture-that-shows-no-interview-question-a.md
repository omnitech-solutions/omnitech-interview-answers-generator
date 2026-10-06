---
id: ADR-0027
title: "Treat a capture that shows no interview question as a note, not a task"
status: Proposed
date: 2026-10-05
proposed_date: 2026-10-05
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0016]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, capture, tasks, live-ui]
related_briefs: []
related_research: []
---

# ADR-0027 — Treat a capture that shows no interview question as a note, not a task

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

Automatic capture sees whatever is on screen: the candidate's own editor, notes, Studio's own page, or an unreadable frame. Treating each as a task filled the feed with junk tasks and stole selection from real ones. Studio's own page cannot be recognised by URL or title without breaking the rule against reading window titles, so recognition has to come from the model's classification.

Source of the decision: plan decision D36 in `bionic/inbox/redesign/plan.md` (owner: "go with option 2 for the junk tasks", 2026-10-05).

## Decision

1. **A closed category.** The model reports a capture with no interview question through a closed category `no-question`, replacing the earlier other-with-an-apology path. The server stores the observation as before, with unchanged retention, and the feed marks it `noQuestion`.
2. **It is not a task.** A no-question capture takes no ordinal and no chip, is never the newest task, never pins or steals selection, raises no missing-context strip, and appears only as a small transcript note naming the capture. Back-to-newest means the newest real task with an answer.
3. **Auto backs off.** After a no-question result Auto does not capture again until the screen changes substantially or a cooldown passes. Manual capture always works and always says what it found.
4. **A spoken question is never a note.** A speech-only call that answers no-question is a violation, not a note.
5. **Known limit.** Studio's own page is caught by classification plus back-off, not by name.

## Alternatives Considered

### Option A — Keep junk captures as tasks the owner dismisses
- **Pros:** no new category.
- **Cons:** the feed fills with junk; selection is stolen.
- **Why not:** the owner chose option 2.

### Option B — Detect Studio's own page by URL or title
- **Pros:** precise.
- **Cons:** reads window titles, which the privacy rules forbid.
- **Why not:** the rule against reading titles stands.

## Consequences

**Positive:**
- The task list holds only real problems; Auto stops spawning one task per screen change.

**Negative:**
- Classification quality depends on the model; the stale "Drafting" marker seen once on native Manual no-question is not reproduced (final report item 3).

## References

- `bionic/inbox/redesign/plan.md` decision D36.
- `products/interview/src/backend/live-session/assist-stage.ts` (the `no-question` category and its guard).
- `packages/interview-contracts/src/live-session.ts` (`noQuestion`).
