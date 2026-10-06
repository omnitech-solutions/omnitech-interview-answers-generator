---
id: ADR-0032
title: "Keep the toolbar capture a one-shot analysis and stage answer-pane captures in the tray"
status: Proposed
date: 2026-10-05
proposed_date: 2026-10-05
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0018]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, capture, toolbar, live-ui]
related_briefs: []
related_research: []
---

# ADR-0032 — Keep the toolbar capture a one-shot analysis and stage answer-pane captures in the tray

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

Two capture entry points exist. The toolbar's capture control analyses the current screen as a new problem immediately. The answer pane's capture adds to a task and stages into the screenshot tray until Apply. The owner suggested the toolbar capture use the same staging; the lead recorded the question as open item 2 of `bionic/inbox/redesign/final-report.md`, and the owner then locked the toolbar's behaviour.

## Decision

1. **The toolbar capture is a one-shot analysis.** Its behaviour is locked: a click captures the current screen and analyses it as a new problem. Its chevron, right-click and Down key open the screen menu; that does not change.
2. **The answer pane's capture stages.** It adds a screenshot to the task it was opened from and stages it in the tray with that task as target; nothing is sent until Apply (see the revisions ADR).
3. **The two flows have different intents,** a new problem and added context to a known one, and stay separate controls with their own labels and targets.
4. **No change is made** to the toolbar's capture or to the footer.

## Alternatives Considered

### Option A — Make the toolbar capture stage as well
- **Pros:** one staging model everywhere.
- **Cons:** an extra Apply step for the common case; changes a locked toolbar.
- **Why not:** the owner locked the toolbar behaviour.

## Consequences

**Positive:**
- The common action stays one click; added context stays deliberate.

**Negative:**
- Two capture entry points with different results; the labels must carry the difference.

## References

- `bionic/inbox/redesign/final-report.md` (section 6, item 2) and the plan's user note on screenshot 50.
- [[adrs/ADR-0018-capture-on-demand-with-masks-and-owner-requested-companion-captures]]
