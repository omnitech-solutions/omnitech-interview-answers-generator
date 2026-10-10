# Call fixtures

Recorded and scripted calls the live coach is replayed on. One folder per call:

| File | What it is |
|---|---|
| `transcript.txt` | The call as a recorder writes it: a time line, then `Label: text`. What the coach is replayed on. |
| `expected.json` | Who is who, the questions the call holds with the words that complete each, and the stretches that are no question (`quiet`). A run is scored against it. With more than one interviewer, each question also says who asks it (`from`). |
| `plan.md` | The plan for the call, given to the coach as the person would have written it. Optional. A panel's plan names the panel in one line, `panel: Name (what they judge), Name (…)`, which the coach reads as its roster. |
| `script.json` | Only for a scripted call: who says what, after how long, how fast. `transcript.txt` is made from it with `pnpm coach:fixture <name>`; a test fails when the two differ. This is also what a simulated recording would be made from later (one utterance per line, with its start and end). |

## The calls

- `screening-services`: 107 seconds of a recorded screening call (real speech, no names): a slow two-part question, a long answer, a follow-up.
- `panel-round`: ten minutes, five interviewers and one candidate. Opens with the stretch above, then a scripted, exaggerated panel. `expected.json` names the scenario each question stands for.

## Running them

| Command | What runs | How long |
|---|---|---|
| `pnpm test` (the `call fixtures` suite) | Every fixture's decisions, with no model: each question is acted on once whole, within the fixture's budget of early and wasted acts. | seconds |
| `pnpm coach:bench:timing`, `pnpm coach:bench:panel:timing` | The same decisions, printed and compared with the last run. | a second |
| `pnpm coach:bench:claude`, `pnpm coach:bench:codex` | The short call, live, with the model writing notes. | under 2 minutes |
| `pnpm coach:bench:panel:claude`, `pnpm coach:bench:panel:codex` | The panel, live, at the speed it was said. Each line carries its interviewer's name, as a recorder's labels give it. | about 10 minutes |
| `pnpm coach:bench:panel:unnamed:timing`, `pnpm coach:bench:panel:unnamed:claude`, `pnpm coach:bench:panel:unnamed:codex` | The panel with nobody named (`--no-names`): how a live call is heard, one stream of call audio. Kept and compared as its own benchmark, `panel-round-unnamed`. | a second; about 10 minutes |

Add `-- --trace` to a live run to print every prompt, raw reply and note revision. Results are kept in `.dev-local/benchmarks/` and each run is compared with the last of the same call on the same runtime.

## Names in a panel

A fixture with more than one interviewer label is replayed with each interviewer's lines under their name, and its questions say who asks each (`from`). A live run then reports, per question, who asked and who the note says asked, and in its last line how many notes named the right person, the wrong person and nobody. Naming nobody is safe; naming the wrong person is the failure to watch. When the coach acts does not depend on the names: the `call fixtures` suite replays the panel both ways and holds the decisions equal. A fixture with one interviewer carries no names and no `from`.

## Adding a call

Make a folder, put a `transcript.txt` in it (or a `script.json` and run `pnpm coach:fixture <name>`), write `expected.json`, and run `pnpm coach:replay --bench <name> --timing`. A real recording must hold no names and nothing private.
