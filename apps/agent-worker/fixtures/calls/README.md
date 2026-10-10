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

## What the notes say

A replay can be given the person's material, and then the coach draws its facts from the context pack exactly as the live coach does (the `coach` projection, read as a remote reader, so a device-only source is withheld):

```
pnpm coach:replay --bench panel-round --runtime scripted \
  --matrix products/interview/fixtures/context-pack/kestrel-freight-pay/matrix.json \
  --brief products/interview/fixtures/context-pack/kestrel-freight-pay/employer-brief.json \
  --application products/interview/fixtures/context-pack/kestrel-freight-pay/stages.json --stage 2
```

`--preferences FILE` and `--kept FILE` (a pack a model prepared earlier) add to it. `--transcript FILE` names the transcript by a flag. Every path may be absolute, under `~`, or from the repository's root. `--runtime scripted` writes each note in code from the first fact of a role the coach was given, on a stepped clock: no model, the same run every time.

In `expected.json` a question may say whose evidence a right note draws on: `"evidence": ["Employer A", "Employer B"]`, or `"evidence": []` / `"nothing": true` when the material has nothing for it. Each question is then scored (`src/coach-notes-score.ts`):

- **in time**: the note's first line is on screen within `--within` seconds (default 10) of the question's last word.
- **evidence / wrong**: the places the note's claims were verified against (the coach's own verifier marks them) that are under an accepted employer's role, and under another employer's. **offered** says whether the facts the coach was given held an accepted employer's at all, so a note that ignored the right fact is told apart from a pack that never offered it.
- **invented**: figures and employer names of the matrix that the note states and that are in neither the facts it was given, nor the plan, nor anything said so far. A floor, not a verdict: it cannot see an invented technology, project or company, nor a real figure put on the wrong claim.

The last line is the run in short: `TOTALS: right evidence N of M, wrong employer N, invented N, in time N of M`.

When any file is outside the repository (a person's own call or material), what is printed and kept holds ids, pointers, counts, clock times and scores only, never what was said or written (`--trace` is the one way to see it), and the result is kept only under `.dev-local/` or outside the repository.

## Adding a call

Make a folder, put a `transcript.txt` in it (or a `script.json` and run `pnpm coach:fixture <name>`), write `expected.json`, and run `pnpm coach:replay --bench <name> --timing`. A real recording must hold no names and nothing private.
