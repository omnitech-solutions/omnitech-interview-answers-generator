---
title: "When the live coach acts: whole questions, no early calls, no call storms"
slug: coach-turn-taking
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [coach, live-session, timing]
related_adrs: []
---

# When the live coach acts: whole questions, no early calls, no call storms

## Problem

The coach (ADR-0039) decides when to call a model from three numbers: a pause of 1.2 s, a longest
wait of 6 s, and 30 words of unprompted talk by the candidate. Replaying the recorded
Zensurance screening call (2026-10-08, 10:33–11:12, 4,241 lines, fragments of one to ten words)
through that logic with a model that answers at once shows three defects.[^sim]

| Defect | What happened in the replay | Why |
|---|---|---|
| It acts on half a question | At 10:40:01 it called with "so the first question I have is about micros…" and the tail of the candidate's previous answer; the question itself ("how do you decide when a feature … should be a microservice or stay in the monolith?") arrived at 10:40:10 and cost a second call | The longest wait (6 s) is counted from the first new word, and the interviewer took 15 s to ask |
| One question becomes several calls | "I want to hear a little bit more." / "So what about business boundary or data ownership…" / "How do you take data?" were three calls in six seconds (10:41:31, :35, :37) | Each short pause ends a stretch; nothing joins the sentences of one turn |
| A call storm while the candidate answers | 86 calls in 13.5 minutes, about one every 9 s; during a 75 s answer the coach called six times | Every 30 words of the candidate's talk is "worth reading" |

The prompt does give the model the whole conversation each time, so a later call can still see an
earlier fragment. What is lost is time (a real call takes about 5 s, so calls queue behind each
other and the note for the real question is late), money, and calm: every call is a chance to
post a note the person did not need.

## What a good coach does (the behaviour to reach)

1. **A turn is the unit, not a pause.** Lines are gathered into the turn of one speaker. The
   interviewer's turn is over when the other side starts speaking, or when the interviewer has
   been silent for a stated time after a sentence that reads as finished.
2. **Fast on a finished question, patient on an unfinished one.** A turn that ends in a question
   or a request ("tell me", "walk me through") is acted on after a short pause (about 0.8 s). A
   turn that trails off ("so, um…", "and our,") waits longer (about 2.5 s) and never forever
   (a ceiling of about 8 s of silence, not 6 s from the first word).
3. **A follow-up in the same breath joins the question.** New interviewer sentences within the
   turn extend it; if a call is already running for the turn's first part, it is cancelled and
   made again with the whole turn, under the same note.
4. **The candidate's answer is watched, not interrupted.** While the candidate is answering, the
   coach looks at most once every 20–25 s and only after enough has been said (about 60 words),
   and only to steer: a missed point, a risky claim, a ramble. It never restates the answer.
5. **Acknowledgements and noise are not turns.** "Okay", "yeah", "um" and a speaker label that
   flips for one word (the recorder's diarisation does this constantly) neither end a turn nor
   start one.
6. **Every decision is explainable.** For each stretch the coach records why it acted or waited
   (turn ended by speaker change, by pause, by ceiling; skipped as acknowledgement), with ids and
   timings only, so a replay can show it.

## Options

- **A. Tune the three numbers.** Cheap; cannot fix the half question (a fixed wait is either too
  short for a slow asker or too long for a quick one) or the storm.
- **B. Turn-taking as above, as a pure function** `decide(lines, now, state) → wait | act(turn) |
  recall(turn)`, tested on recorded timings without a model. The coach loop only obeys it.
- **C. Ask a small fast model "is the question finished?"** Accurate, but adds a call and its
  delay before every note, and an on-device model the owner has said not to load unasked.

Recommended: **B**, with the sentence-finished test as plain rules (ends with "?", a request
phrase, or a falling "… yeah." after a question word), and C kept as a later refinement.

## How it is checked

- The replay lab ([[briefs/BRIEF-coach-replay-lab]]) run without a model over the recorded call:
  one action per interviewer question (about 20 in that call), none on a half question, at most
  one look per 20 s of candidate talk; the time from the end of a question to the action is
  under 1.5 s for a finished question.
- Synthetic turn files for: a slow asker, a two-part question, an interruption, back-channel
  noise, the candidate asking the questions at the end.

## Open questions for the owner

1. During your own answer, do you want the coach silent unless something is wrong, or a short
   "next point" nudge every so often?
2. When the interviewer adds to a question after a note has started to appear, replace the note
   in place (recommended) or add a second one?

[^sim]: Informative. A replay of the coach's own decision code with a stand-in model on
    2026-10-09; speaker labels as the recorder gave them (Speaker 1 interviewer, Speaker 2
    candidate, "Unknown" as unknown). The recorder mislabels many fragments, which the live
    session does not (it knows the microphone from the call's audio).
