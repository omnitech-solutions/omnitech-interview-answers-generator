---
title: "Ready for the Zensurance technical round on 2026-10-16"
slug: zensurance-technical-round
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [interview, readiness, coach]
related_adrs: []
---

# Ready for the Zensurance technical round on 2026-10-16

## The event

Friday 2026-10-16, 11:00–13:00 MT, Zoom, three interviewers (engineering manager, tech lead,
senior staff developer). Their guide: **hour one, live coding** on a shared full-stack
repository (NestJS and React), finding issues, writing tests and fixing bugs while explaining;
**hour two, system design** in a diagramming tool, requirements first, trade-offs, failure
modes, and how the work would be split across a team. GitHub Codespaces is the recommended
environment. AI use is allowed; their recruiter advises showing it openly: share the screen,
show how you direct, check and correct it.

## What that asks of the coach

| Their criterion (from the guide) | What the Studio must do in the room |
|---|---|
| Understand the business requirement before coding | First note on a task: the requirement restated in one line and two questions to ask |
| Identify issues, write tests, fix bugs, explain | Read the shared code from the screen; name the likely defect class (N+1, missing transaction, missing validation) with where to look; a test to write first; never paste a whole solution |
| Code quality, data design, validation | A short checklist per change: input validated, transaction boundary, error path, test |
| Speed against correctness | A clock: time used in the hour, what to cut |
| Gather requirements, then design | Staged design notes ([[briefs/BRIEF-system-design-coaching]]) |
| Failure modes | The fixed list per component, when asked |
| Breaking work down for a team | A note kind for "how I would split this": slices, order, what to parallelise |

## What must be true by Thursday 2026-10-15

1. The coach acts on whole questions and stays quiet during answers
   ([[briefs/BRIEF-coach-turn-taking]]), proven on the recorded screening call and on three
   rehearsal recordings.
2. The owner can rehearse: replay a transcript with named speakers and watch the notes
   ([[briefs/BRIEF-coach-replay-lab]]), and record his own practice
   ([[briefs/BRIEF-record-transcript]]).
3. The coach has a call plan and a running log
   ([[briefs/BRIEF-coach-by-hand-and-by-studio]]), with the Zensurance brief, the three
   interviewers and what the screening call revealed (the team is a data provider to the rest of
   the company; a rules engine with a GUI; NestJS; DORA metrics came up) loaded.
4. The coach can see the shared screen for the coding hour (screen capture exists; it must be
   one of the coach's inputs, not only the answer panel's).
5. Two full dress rehearsals have been run end to end with Zoom screen sharing on, one per
   hour, and the layout checked so the notes sit near the camera and nothing private is in the
   shared area.

## Using it openly

Their recruiter's advice is to be transparent about AI. A coach feeding lines unseen is not
that, and three interviewers watching a shared screen and a face for two hours are likely to
notice reading. The plan that fits their advice and is also the stronger showing: in the coding
hour, use the assistant in the open in the editor ("I will ask it for the test, then check it"),
and keep the Studio's notes to prompts and checks, not sentences to read. Decide this before
the rehearsals, since it changes what the notes should say.

## Open questions for the owner

1. Open or private on the day, per hour? (Above.)
2. Which diagramming tool, and Codespaces or local?
3. Who plays the interviewer in the rehearsals: a person, or the Studio's rehearsal mode?
