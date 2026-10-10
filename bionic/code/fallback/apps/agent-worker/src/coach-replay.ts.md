# apps/agent-worker/src/coach-replay.ts

_Source: `apps/agent-worker/src/coach-replay.ts` (header-comment fallback)_

Replays a recorded conversation through the live coach, to see when it
acts, why, and what it writes.

pnpm coach:replay <file> --speakers
who is in the file: each label, how much they said, a first sentence
pnpm coach:replay <file> --interviewer "Speaker 1" --me "Speaker 2" --timing
when the coach would act and why; no model is called, it takes a second
pnpm coach:replay <file> --interviewer "Speaker 1" --me "Speaker 2" \
--from 10:39:50 --to 10:47:00 --runtime claude
the same stretch with Claude Code writing the notes, at the speed it
was said

Options
--interviewer L   --me L   --leave-out L     a label's part; repeat, or a,b
--unknown-is interviewer|me|leave-out        what unnamed labels are
--plan FILE       the plan for the call, given to the coach with every stretch
--trace           print everything: each prompt the model is given, its raw
reply, and each revision of each note as it is posted
--bench NAME      a call fixture (fixtures/calls/NAME): its transcript, its
plan, who is who and what is expected, in one word
--results DIR     where a benchmark's result is kept and the last looked
for (default .dev-local/benchmarks/)
--expect FILE     a benchmark: the questions the stretch holds and the words
that complete each. The run is scored against them, the
result is kept in .dev-local/benchmarks/ and compared with
the last run of the same benchmark on the same runtime
--no-activity     do not tell the coach who is speaking (by default a replay
derives it from the recording's timings, as a stand-in
for a voice-activity signal)
--no-names        do not tell the coach which interviewer spoke. By default a
replay with more than one interviewer label gives each
line its label as the speaker's name (the recorder told
them apart). A call heard live is one stream with nobody
named: this replays a panel the way it is heard live
--signals ideal|vad    what the replay knows of who is speaking. ideal (the
default): exactly the recording's timings. vad: as a
voice detector hears it, a start told 150 ms late, a
stop 500 ms late, pauses shorter than that not heard,
and each piece of text 300 ms after it was said
--endpoint FILE   a module that decides when a speaker's turn is over, in
place of the replay's own reading of the signals. Its
default export is given { kind } and returns
{ apply(events, nowMs), ready(role, nowMs), close?() }
--endpoint-kind K which of the module's mechanisms
--endpoint-owns   the endpoint alone says when the interviewer has
finished: the coach's own waits after a turn are zero
--label L         kept with a benchmark's name, so each variant is
compared with its own last run
--retain          keep one session of the model open for the whole replay
(each turn then sends only what is new)
--hide-me         the coach does not hear the person being coached
--from T --to T   the stretch to replay (HH:MM:SS of the file's clock)
--timing          decisions only, no model
--latency S       with --timing: how long the absent model takes (default 4)
--runtime claude|codex    who writes the notes (default claude)
--speed N         N times faster than it was said (default 1). Above 1 a
model's delay looks N times longer than it is.
--studio          also show the notes in the running Studio's notes pane,
as replay notes: kept apart from your own, in memory

Nothing is kept: the transcript and the notes of a replay live in this
process, unless --studio is given. With no part named for any label and a
terminal to ask in, it asks.
