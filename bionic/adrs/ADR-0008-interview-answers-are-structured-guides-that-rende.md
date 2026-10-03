---
id: ADR-0008
title: "Interview answers are structured guides that render their Markdown"
status: Proposed
date: 2026-10-02
proposed_date: 2026-10-02
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [interview, answers, contracts, playground]
related_briefs: []
related_research: [references/interview-studio]
---

# ADR-0008 — Interview answers are structured guides that render their Markdown

## Context

Retroactive record of a change already made and enforced. Until commit
`f36af02` ("every Workspace answer has a guide"), an interview answer carried a
free-form `answerMarkdown` field, optionally beside a structured guide that a
reconciliation step tried to keep in agreement with it. The Workspace walks a
person through Understand → Plan → Code → Test → Explain stages
([[research/references/interview-studio]]), and those stages need structured
content, not prose to parse. Commit `c050ef6` updated the answer contract in
the former `.rulesync/skills/interview-question-router/SKILL.md` and the
Playground controller skill to match (both at commit `4c50c5e`).

## Decision

1. **The guide is the answer.** Every generated, saved, stored and pushed
   Workspace answer carries a structured `guide`. Its shape is
   `answerGuideSchema` in `packages/interview-contracts/src/guide.ts` (version
   `1`), which is the source of truth for the fields and their limits.
2. **Markdown is derived.** An answer's Markdown (`answerMarkdown`, with the
   `## Question`, `## Approach`, `## Complexity`, `## Edge cases` and
   `## Talking points` sections) is always rendered from the guide by the
   contracts package. No producer — model, assistant proposal, CLI or
   Playground push — supplies `answerMarkdown` itself.
3. **Validation at every entry.** Model generation must return a guide; the
   Playground rejects a pushed answer without a valid guide and renders its
   Markdown server-side; drafts re-render Markdown on every write.
4. **Separate fields.** Main solution, executable usage/output, and executable
   tests stay in separate answer fields (`code`, `usageCode`, `testCode`) so the
   Playground can edit and run them in order.

## Alternatives Considered

### Option A — Keep Markdown as the source and parse stages out of it
- **Pros:** One free-form field; easy for a model to write.
- **Cons:** Stage views depend on heading conventions; parsing is fragile and
  silently lossy.
- **Why not:** The stages need fields, not prose.

### Option B — Keep both fields and reconcile them
- **Pros:** Backwards compatible with Markdown-only answers.
- **Cons:** Two sources of truth that drift; the reconciliation code was its
  own source of defects.
- **Why not:** One authoritative field removes the drift entirely.

## Consequences

**Positive:**
- Every view of an answer agrees, because each renders from one structure.
- Producers are validated against one schema.

**Negative:**
- The Markdown-only answer format and its fallbacks are gone; older
  Markdown-only answers are not accepted as new input.
- A model must produce schema-valid structured output.

**Follow-on work:**
- The interview answer skills describe the guide (already done in `c050ef6`).

## References

- `packages/interview-contracts/src/guide.ts` (`answerGuideSchema`, `renderGuideMarkdown`).
- Commits `f36af02` and `c050ef6`.
- [[research/references/interview-studio]]
