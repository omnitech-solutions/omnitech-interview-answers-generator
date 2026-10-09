# apps/agent-worker/src/coach-listen.ts

_Source: `apps/agent-worker/src/coach-listen.ts` (header-comment fallback)_

The live coach's ear, for an agent that coaches by hand (Claude Desktop,
Codex Desktop): it waits until the conversation reaches a moment to act on,
prints that moment as JSON, and exits. The agent then writes the note
(`node scripts/coach-note.mjs '<json>'`) and listens again.

pnpm coach:listen            wait for the next moment (at most 10 minutes)
pnpm coach:listen --reset    forget where it had read to, then wait

The Studio decides WHEN (the same turn-taking the built-in coach uses,
turns.ts); the agent decides WHAT. It reads the same feed the built-in coach
reads, so run the Studio with INTERVIEW_COACH=off while an agent coaches:
one coach at a time.

What it prints, on one line:
{ "reason": "question-finished" | "pause" | "speaker-change" | "answer-check",
"about": "interviewer" | "candidate",
"turn": "the words of the turn to answer",
"new": [ { "speaker", "text" } ],          the lines not yet coached
"before": [ { "speaker", "text" } ],       the last of the conversation
"plan": "the plan for the call, if one is set",
"key": "a key for the note, so a second note for this turn replaces the first" }
Exit 0 with a moment, 2 when nothing happened in time, 1 on an error.
