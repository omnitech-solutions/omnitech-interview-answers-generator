---
title: "One coach, three ways to run it: the Studio alone, Claude Desktop, Codex Desktop"
slug: coach-by-hand-and-by-studio
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [coach, agents, harness]
related_adrs: []
---

# One coach, three ways to run it: the Studio alone, Claude Desktop, Codex Desktop

## Problem

On 2026-10-08 an assistant in Claude Desktop coached a real screening call by hand and the owner
found its notes "much more useful than the rest of the application". The Studio now has its own
coach (ADR-0039). The owner wants both: the Studio coaching hands-off with no second
application, and the option to have a desktop agent (Claude or Codex) do it, because that may
give better notes. The two must not be two products.

## What the hand-run coach actually was (from that session's own record)

| | By hand, 2026-10-08 (Claude Desktop, Opus) | The Studio's coach today (worker, Sonnet or Codex) |
|---|---|---|
| How it heard | A shell script polled the session's stored transcript lines in Postgres every 2 s and exited when a line of five or more words was followed by about 4 s of quiet; the exit woke the assistant | The Studio pushes each stored line to an in-memory feed; the worker reads it every 0.3 s |
| Who spoke | Call audio = them, microphone = me (the same rule) | The same |
| When it acted | 81 wake-ups in 38 minutes, a median of 24 s apart; 39 notes; the others it judged "still the same answer, no new note" | A pause of 1.2 s or 6 s at most; see [[briefs/BRIEF-coach-turn-taking]] for what that gets wrong |
| Delay | About 4 s of quiet + 2.6 s to read + about 7 s to write and post: the assistant's own estimate was 20–40 s from the end of a question to a note | About 5 s to the first line, the note growing as it is written |
| What it knew | The whole working conversation: the job description and a prepared pack pasted beforehand, its own running log of the call ("covered so far", what she revealed, 7 of 8–9 questions done), and everything said so far | The last 12,000 characters of the conversation, the titles of its last eight notes, and the facts the context pack selects for the stretch |
| Judgement | One long-lived mind: it remembered its earlier advice, counted questions, noticed a drift ("Steer: writes, not the graph"), pre-posted "your questions for her" near the end | A fresh call each time with no memory but what the prompt carries |
| Notes | Markdown, 10–15 lines, with documentation links; each replaced the last | Structured lines (say, anchors, ask, caution), three at most, cited to the record |
| What went wrong | Late; long; replaced mid-answer; a context compaction mid-call cost 84 s | Acts on half questions; calls too often (same brief) |

So the hand-run coach was not better because of the model call. It was better because it was
**one continuing session with a memory and a plan for the call**, and worse because it was slow
and wordy. The Studio's coach is fast and short and has no memory or plan.

## Proposed: one coach contract, three runners

1. **The coach contract** is what already exists: read the transcript feed, post notes
   (`/api/v1/coach-transcript`, `/api/v1/coach-notes`). Anything that speaks it is a coach.
2. **The Studio's own runner** (the worker) gains what made the hand-run coach good:
   - **a call plan**, written before the call from the brief and the stage (what they will
     judge, the stories to land, questions to ask), given on every call;
   - **a running log**, kept by the coach itself and carried forward: questions asked so far,
     what the interviewer revealed, which stories were used, what was promised;
   - **a session that stays open** for the length of the call where the runtime supports it
     (both agent runtimes can resume a session), so the model keeps its own thread and each
     turn sends only what is new. This is the main gap between "live in a desktop agent" and
     "a direct call", and it also makes each turn cheaper and quicker.
3. **A desktop agent as the runner** (Claude Desktop, Codex Desktop): a small command the agent
   runs, `interview-answers coach listen`, that blocks until the turn-taking rule says "act"
   and prints the turn, the plan and the selected facts; and `interview-answers coach note` to
   post. The agent's loop is then "listen → think → note → listen", with the Studio deciding
   *when* and the agent deciding *what*. A project skill carries the note rules. No database
   polling, no browser scripting.
4. **Only one coach writes at a time**: starting a desktop coach pauses the worker's for that
   session, and the window says which is coaching.

## Options

- **A. Keep them separate** (desktop agents coach by their own means). No work; the timing bugs
  are solved twice and the notes differ in shape.
- **B. As proposed.** Recommended.
- **C. Studio only.** Simplest for the day; gives up the option the owner asked to keep.

## Open questions for the owner

1. On the day, which runs: the Studio's own (recommended: fewer moving parts while you share a
   screen), with a desktop agent as the fallback you have rehearsed?
2. May the Studio's coach keep its running log in the notes file after the call, as your record
   of what was asked? (The hand-run one did, in `.dev-local/interview-notes/`.)
