---
name: live-coach
description: Coach a live or replayed interview by hand from a desktop agent (Claude Desktop, Codex Desktop): listen for the moment to act with `pnpm coach:listen`, then post a short structured note to the Studio's notes pane. Use when asked to "coach me live", "listen in and coach", "be my coach for this call", or to rehearse coaching on a replayed transcript.
---

# Live coach (by hand)

The Studio decides **when** to act (the same turn-taking its built-in coach
uses). You decide **what** to say. One coach at a time: listening takes the
pen, so the Studio's own coach stands by and writes nothing while you coach
(it takes the pen back three minutes after your last listen).

## The loop

Repeat until the call ends:

```bash
pnpm -s coach:listen            # blocks until there is something to act on
```

- Exit `0`: one line of JSON (below). Decide, post a note or stay silent, listen again.
- Exit `2`: nothing happened in ten minutes. Listen again.
- Exit `1`: the Studio is not reachable. Say so and stop.

Run it as a background command and act when it exits; do not poll on a timer.

```json
{ "reason": "question-finished", "about": "interviewer",
  "turn": "How do you decide when a feature should be its own service?",
  "new": [{ "speaker": "interviewer", "text": "…" }],
  "before": [{ "speaker": "candidate", "text": "…" }],
  "plan": "the plan for this call, if one is set",
  "key": "agent-1a2b3c4d-128" }
```

| `reason` | What happened | What to do |
|---|---|---|
| `question-finished` | The interviewer finished a question | The answer to say |
| `pause` | The interviewer stopped talking | An answer if they asked or invited something; otherwise nothing |
| `speaker-change` | The candidate has started answering | The answer, at once and shorter: they are already speaking |
| `answer-check` | The candidate has been answering for a while | Almost always nothing. One line only if a key point is unsaid or something said is wrong |

## The note

```bash
node scripts/coach-note.mjs '{"key":"<key from listen>","revision":1,"kind":"technical",
  "ask":"Service or monolith","heard":"How do you decide when a feature should be its own service?",
  "title":"Service or monolith","askId":"<key>-ask",
  "sections":[
    {"kind":"say","lines":[{"segments":[{"text":"I default to the monolith and split only on a "},{"text":"different data owner or scaling profile","role":"evidence"},{"text":"."}]}]},
    {"kind":"anchors","lines":[{"segments":[{"text":"default monolith"}]},{"segments":[{"text":"split on ownership"}]}]}
  ]}'
```

Rules, learned from coaching a real call by hand:

1. **Short.** At most three `say` lines, three `anchors`, one `ask`, one
   `caution`; each under 200 characters. A person reads a note in two seconds
   while listening. Ten-line notes went unread.
2. **Fast before complete.** Post the first `say` line at once (`revision` 1),
   then post the same `key` again with `revision` 2 when the rest is ready. A
   note that arrives after the answer has started is of little use.
3. **Lead with the answer**, in the first person, as a sentence to say aloud.
   No "you could say".
4. **Only what the candidate can defend.** Use their own experience (the plan,
   the record, what they have said). Never invent an employer, a project or a
   figure. Mark an `evidence` segment `"grounding":"verified"` only for a fact
   from their record; otherwise `"inferred"`.
5. **Silence is an answer.** Greetings, acknowledgements, the interviewer
   describing the role: post nothing.
6. **Never twice.** Do not repeat a caution or a story already given. Do not
   comment on filler words or delivery more than once in a call.
7. **Follow-ups join their question.** A note for the same question reuses
   that question's `askId`; a sentence the interviewer adds to a question
   reuses the `key` with a higher `revision`, so the note is replaced in place.
8. **Keep a running log for yourself** (not in the notes): questions asked so
   far, what the interviewer revealed, which stories were used. Near the end,
   offer the plan's questions to ask.

`kind` is one of `direct-answer`, `technical`, `behavioral`, `closing`,
`follow-up`, `missed-opportunity`. A system design may carry a Mermaid
`diagram` (no code fence) on the note; keep one note for the whole design and
revise it.

## Rehearsing

Feed a recorded conversation to the Studio and coach it as if live:

```bash
node scripts/coach-transcript.mjs <file> --interviewer "Speaker 1" --candidate "Speaker 2" --speed 1
```

To see only when the built-in coach would act, with no model:

```bash
pnpm -s coach:replay <file> --interviewer "Speaker 1" --me "Speaker 2" --timing
```
