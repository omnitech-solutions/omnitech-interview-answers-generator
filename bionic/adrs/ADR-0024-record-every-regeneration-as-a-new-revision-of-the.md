---
id: ADR-0024
title: "Record every regeneration as a new revision of the same task and stage added screenshots until Apply"
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
tags: [active-session, revisions, screenshots, privacy, live-ui]
related_briefs: []
related_research: []
---

# ADR-0024 — Record every regeneration as a new revision of the same task and stage added screenshots until Apply

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

A live task is the problem the owner is working on. The owner can regenerate its answer, add screenshots to it, or send several screenshots at once. Earlier answers were being rewritten in place, which breaks the stale-result rejection and the fence that keep a late model result from overwriting a newer one, and which hides what the owner saw before. Screenshots are also private: nothing should leave the device before the owner chooses.

Source of the decisions: plan decisions D28, D29, D30 and D34 in `bionic/inbox/redesign/plan.md` (owner directives of 2026-10-05).

## Decision

1. **A regeneration is a new revision.** Re-running a task, or adding context to it, creates a new revision of the same task with a recorded reason (`regenerate` or `added-screenshot`). A published revision is never rewritten. Earlier revisions stay viewable and are marked Outdated when a newer one exists.
2. **A task is one transcript item.** Revisions never add transcript rows. The owner selects a revision from a list on the task header, newest first, each showing its time and what produced it; selecting one is view-only and switches the answer, code, tests, constraints, missing-context note and the task's chat text to that revision. Follow-ups go to the task's current revision, and the composer says so while an older revision is shown. A task is a light container: no nesting and no per-revision rows.
3. **Context travels with the regeneration.** Every screenshot of the task (within the existing bound) goes with a regeneration, so added context is actually seen. A device-only session refuses image analysis, as before.
4. **Added screenshots stage on the device.** A screenshot added to a task is shown as a removable thumbnail marked "Not sent yet". Nothing is uploaded and no model call is made until the owner presses Apply. Apply is one atomic request that produces exactly one new revision however many images were staged. Discard drops the staged images.
5. **Manual mode stages new problems the same way.** In Manual mode a capture only stages. Apply sends all staged images, in the order the owner chose, as one atomic request: with no target it creates one new task from the images, with a target it creates one revision of that task. The owner can crop, remove and reorder staged images, with keyboard access. Order is meaningful: images become consecutive screen observations in that order and the model receives them in it. Auto mode is unchanged: each automatic capture is its own new task.
6. **Regenerate without new context** is a separate control that re-runs the task from its existing sources and produces a new revision.

## Alternatives Considered

### Option A — Rewrite the answer in place
- **Pros:** no revision list to build.
- **Cons:** breaks the stale-result rejection and the fence; loses the earlier answer.
- **Why not:** the correctness rules depend on a published revision being immutable.

### Option B — Upload an added screenshot immediately
- **Pros:** the model call can start at once.
- **Cons:** content leaves the device before the owner commits; several additions cause several revisions.
- **Why not:** it weakens the privacy position and multiplies revisions.

### Option C — Make revisions their own rows in the transcript
- **Pros:** every answer is visible at once.
- **Cons:** the transcript grows with each regeneration and the task identity blurs.
- **Why not:** the owner asked for one item per task.

## Consequences

**Positive:**
- The owner sees what each answer was based on, and nothing is sent before Apply.
- Late results cannot overwrite a newer revision.

**Negative:**
- More state on the device (staged images) and a revision selector in two surfaces (native and web).

**Follow-on work:**
- The two capture entry points differ by intent; see the ADR on the toolbar capture.

## References

- `bionic/inbox/redesign/plan.md` decisions D28, D29, D30, D34.
- `packages/interview-contracts/src/live-session.ts` (`LIVE_REVISION_REASONS`, the operation enum).
- [[adrs/ADR-0016-run-active-session-assistance-on-the-worker-executor]]
