# Manual listening: design proposal (2026-10-06)

Owner's description: when listening in Manual mode, the heard text collects in the prompt
box; Enter drafts the answer; then the next heard speech starts filling the box again.
Answers only for real questions, shown as talking points (bold key words, point form).

## What exists today (verified in code and by replay)
- **Auto** (hands-free): the native engine runs, posts every final phrase to the server
  (`transcript.final`, mic = candidate, application audio = interviewer). The server's
  question gate opens a task per question and the assist stage drafts it. Nothing is typed.
- **Manual** (capture only on Analyze): the engine does NOT run (`wanted` needs Auto on).
  The mic button is the browser's dictation (Web Speech): each final phrase is appended to
  the message box; Enter sends it once and clears it. This is the behaviour described
  above, but it hears only through the browser's recogniser, not the native engine and not
  the other side's audio. Whether Web Speech works inside the Mac app's web view is
  unverified here.
- The engine bridge is content-free by design: no phrase text ever crosses it, only state.

## The gap
In Manual on the Mac app there is no way for the interviewer's speech (system audio, the
engine's strength) to reach the box. Auto answers by itself; Manual hears nothing.

## Options
1. **Do nothing new; Manual keeps browser dictation.** Cheapest. The Mac app's dictation
   needs verifying on the real app; the other side's audio is not heard.
2. **Hold mode on the server (recommended).** A per-session setting `answering: auto | manual`
   (same pattern as `screenshotSend`: a column, a route, a field on the session view).
   - The engine runs in both modes and keeps posting finals (so the transcript, its
     retention and its privacy rules are unchanged).
   - With `manual`, the processor keeps the lines as transcript and opens NO task from
     them. The owner's page reads the new far-side lines from the stream, appends them
     to the message box (marked as heard), and Enter submits the box as owner input, which
     opens the task exactly as typed input does today. The box then clears and the cursor
     moves past the lines it consumed.
   - Auto behaves as now.
   - Needs: a migration, the contract field, the route, the processor standing check, the
     page change, and tests at each layer. Roughly a day of work.
3. **Engine holds text locally.** Cross the privacy line (the bridge would carry phrase
   text) or add a second channel. Not recommended.

## Privacy and honesty
Heard lines are stored as transcript in both modes, as in Auto today; Manual only decides
when a draft is made. The page says so ("Listening. Press Enter to answer").

## Tests (how to check it realistically)
- Replay harness (`e2e/live-session/.audit/replay.mts`): the recorded Zensurance screen
  through the real ingest path with its own pacing; assert, per question, tasks and drafts
  in Auto, and in Manual that no task opens until the owner's input arrives.
- Shim e2e (Playwright with the host shim): the box fills from the stream, Enter sends,
  the box clears, the next phrase refills it.
- Speech loopback on the real Mac (`say` through the speakers into the mic, two voices,
  `[[slnc]]` for pauses): end to end, owner present.

## Decision needed from the owner
Option 2 (recommended) or option 1? Option 2 changes the session model (a new setting).
