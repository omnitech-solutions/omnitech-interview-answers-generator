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

The Workspace walks a person through Understand → Plan → Code → Test → Explain
stages ([[research/references/interview-studio]]). Each stage reads structured
content, and every view of an answer must agree with every other.

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

## Consequences

**Positive:**
- Every view of an answer agrees, because each renders from one structure.
- Producers are validated against one schema.

**Negative:**
- An answer without a valid guide is not accepted as input.
- A model must produce schema-valid structured output.

## References

- `packages/interview-contracts/src/guide.ts` (`answerGuideSchema`, `renderGuideMarkdown`) and `guide.test.ts`.
- `.agents/skills/interview-question-router/SKILL.md` and `.agents/skills/interview-playground-controller/SKILL.md` (the answer contract agents follow).
- [[research/references/interview-studio]]
