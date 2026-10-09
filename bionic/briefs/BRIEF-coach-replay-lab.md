---
title: "Replay a transcript through the coach, with named speakers, in the Studio"
slug: coach-replay-lab
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [coach, testing, transcript]
related_adrs: []
---

# Replay a transcript through the coach, with named speakers, in the Studio

## Problem

The owner needs to test many scenarios before a real interview: paste or drop a transcript, see
who spoke, say who each speaker is, leave some out, mark one as "me", and watch the coach work
as it would have in the room. Today there is only `scripts/coach-transcript.mjs`, which needs
the speakers named on the command line and gives no view of why the coach acted.

## What exists

- The coach's transcript store and routes (`/api/v1/coach-transcript`), the file parser
  (`parseTranscriptFile`), the script that replays at a chosen speed, and the notes pane.
- Speakers arrive as `interviewer`, `candidate` or `unknown`.

## Proposed

A "Replay" entry in the live window (and the same as a command):

1. **Load.** Paste text or choose a file. Formats: the recorder's `HH:MM:SS --> HH:MM:SS` /
   `Label: text` blocks, plain `Label: text` lines, and WebVTT/SRT.
2. **Speakers.** The labels found are listed with how much each said and a first sentence. For
   each: a name, and one of *interviewer*, *me*, *leave out*. Labels can be merged (the recorder
   often splits one person in two: in the Zensurance file "Unknown" is both people).
   **"Me" is the candidate**: by default the coach reads my lines to follow the conversation
   but never coaches the interviewer's side; a switch "hide my lines from the coach" leaves
   them out entirely, to see what it does from the questions alone. *Leave out* removes a
   speaker from what the coach reads.
3. **Run.** Speed (1×, 5×, 30×, as fast as the model answers), start and end time, and the
   runtime (Claude Code or Codex). A second mode, **timing only**, calls no model and shows only
   when the coach would act and why ([[briefs/BRIEF-coach-turn-taking]]).
4. **Watch.** The notes pane as live, plus a timeline: each question, when it ended, when the
   coach acted, when the first line and the last line of the note appeared, and what was skipped
   in silence. A run can be kept as a named scenario and run again after a change, so two runs
   can be compared.

A replay never touches a live session's notes: it runs in its own space (its own transcript and
notes, cleared when closed), so testing cannot overwrite what was coached in a real call.

## Options

- **A. Command only** (extend the script with an interactive speaker step). Fast to build; no
  timeline, no comparison.
- **B. In the Studio as above.** What the owner asked for; needs the notes and transcript stores
  to be per space instead of one per Studio.
- **C. B's server side first, driven by the command, then the screen.** Recommended: the
  scenario runner and the timing-only mode are needed today to fix turn-taking; the screen
  follows on the same routes.

## Open questions for the owner

1. Is "me" read by the coach by default (recommended, it is how it catches a weak answer), with
   the hide switch for the other test?
2. Should a kept scenario store the transcript (it holds real names) or only its path on disk?
   Recommended: the path, never the text, and never in git.
