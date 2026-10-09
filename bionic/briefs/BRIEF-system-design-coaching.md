---
title: "Coaching a system design round: a drawn design with scripted, restrained talking points"
slug: system-design-coaching
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [coach, system-design, interview]
related_adrs: []
---

# Coaching a system design round: a drawn design with scripted, restrained talking points

## Problem

The Zensurance round on 2026-10-16 has one hour of system design with a diagramming tool of the
candidate's choice, judged on gathering requirements, trade-offs, common components, clear
reasons and failure modes (their preparation guide). The Studio can draw (a coach note carries a
Mermaid `diagram`), and the coach can write notes, but nothing ties them into the order a design
conversation runs in, and a drawing that is too complete invites questions the candidate cannot
answer.

## Principle

**Say less than you could, and only what you can defend.** Every box on the drawing and every
line of a note is something the interviewer may ask about. A design is scripted in stages, and
each stage shows only what that stage has earned.

## Proposed

1. **A design is staged**, in the guide's own order: requirements → high-level plan → component
   detail → issues and improvements. The coach knows which stage the conversation is in and
   writes for that stage only.
2. **Requirements first, as questions to ask.** On hearing the problem, the first note is three
   to five clarifying questions (who uses it, how much, what must never be lost, what may be
   late) and nothing else.
3. **The drawing grows.** One diagram per design, revised in place: stage 2 is five to seven
   boxes; a box is added only when the conversation reaches it. Each box carries at most one
   spoken line ("why it is here") and one trade-off ("what it costs"), kept beside the drawing
   as numbered notes, never inside it.
4. **A depth limit.** Each component has a "do not go past" line: the level of detail the
   candidate's own record supports (from the context pack). The coach marks anything beyond it
   as "say you would check" rather than supplying an answer to bluff with.
5. **Failure modes on request.** A fixed, short list per component (what if it is down, slow,
   duplicated, out of order) surfaced when the interviewer asks or in the last stage.
6. **The candidate draws.** The Studio's drawing is the candidate's crib, on their side. What is
   shared on Zoom is the candidate's own Excalidraw; the note says what to add next, in words.

## What exists to build on

- `CoachNote.diagram` (Mermaid), revisions of one note by key, the `technical` note kind.
- Screenshot capture of the shared screen, so the coach can see the candidate's own drawing and
  the code under discussion.

## Open questions for the owner

1. Which tool will you draw in on the day (Excalidraw recommended by their guide)? The crib
   should name shapes the way that tool does.
2. Should the Studio's own drawing ever be shown to them, as the "how I use AI" moment their
   recruiter suggested, or stay private?
