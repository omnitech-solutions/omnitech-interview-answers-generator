# apps/agent-worker/src/coach-listen.ts

_Source: `apps/agent-worker/src/coach-listen.ts` (header-comment fallback)_

The live coach's ear, for an agent that coaches by hand (Claude Desktop,
Codex Desktop): it waits until the conversation reaches a moment to act on,
prints that moment as JSON, and exits. The agent then writes the note
(`node scripts/coach-note.mjs '<json>'`) and listens again.

pnpm coach:listen            wait for the next moment (at most 10 minutes)
pnpm coach:listen --reset    forget where it had read to, then wait

The Studio decides WHEN (the same turn-taking the built-in coach uses,
turns.ts); the agent decides WHAT. Running this takes the pen: the built-in
coach stands by and writes nothing while an agent is listening, and takes
it back three minutes after the agent's last listen.

What it prints, on one line:
{ "reason": "question-finished" | "pause" | "speaker-change" | "answer-check",
"about": "interviewer" | "candidate",
"turn": "the words of the turn to answer",
"new": [ { "speaker", "text" } ],          the lines not yet coached
"before": [ { "speaker", "text" } ],       the last of the conversation
(a line also carries "name",
the interviewer who spoke,
when its source knew: a panel)
"plan": "the plan for the call, if one is set",
"key": "a key for the note, so a second note for this turn replaces the first" }
Exit 0 with a moment, 2 when nothing happened in time, 1 on an error.
