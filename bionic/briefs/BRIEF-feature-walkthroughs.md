---
title: "Show each feature by a worked scenario: what goes in, what comes out, how the Studio uses it"
slug: feature-walkthroughs
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [docs, engine]
related_adrs: []
---

# Show each feature by a worked scenario: what goes in, what comes out, how the Studio uses it

## Problem

The owner needs to understand what was built and how the Studio consumes the AI engine, by
seeing real scenarios with filled-in inputs and example outputs, before reviewing briefs. The
record today is decisions (ADRs) and generated maps, not walkthroughs.

## Style to follow

Taken from `~/legion/labs/harvester` (read 2026-10-09): it has no scenario pages as such; what
works there is (1) an "at a glance" and a "mental model" section with an ASCII diagram, (2)
runbooks whose every step is a filled-in command followed by `# expect:` and the reason, (3)
reference tables, (4) every claim tied to its ADR.

## Proposed page, one per feature, under `bionic/research/walkthroughs/`

1. **At a glance**: three lines and one diagram of who calls whom.
2. **Scenario**: a named situation with synthetic data ("Jordan is asked about a migration").
3. **Step by step**: what the person does in the interface; the request the Studio makes
   (filled in); the engine call it becomes (`engine.stream`, `engine.context.resolve`, …) with
   its input; what comes back (shortened real output); what the Studio does with it and where it
   shows.
4. **What is kept**: the run and its steps as rows, with the query to read them.
5. **Try it**: the command or clicks to reproduce it on this machine.
6. **Limits and decisions**: links to the ADRs.

## Features to cover, in this order

1. The live coach (transcript → turn → engine call → streamed note).
2. The context pack and "Selected for this question".
3. A live answer (the session processor's stages on the engine).
4. A document generated from a template.
5. A briefing / concept explanation.
6. An image for a presentation.
7. An agent job (the assistant) and its events.

## Open question for the owner

Pages in `bionic/` as Markdown, or as a published page with the scenarios runnable? Recommended:
Markdown first, since it is also what an agent reads.
