---
title: "Behaviour flags in Settings, with the environment still winning"
slug: flags-in-settings
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [settings, live-session, coach, native-shell, configuration]
related_adrs: [ADR-0002, ADR-0007, ADR-0011, ADR-0012, ADR-0019, ADR-0039]
---

# Behaviour flags in Settings, with the environment still winning

## Problem

Three switches that change what the product does during a call could only be set in `.env`, and
each was read once when its process started: `ACTIVE_SESSION_VOICE_ACTIVITY`, `INTERVIEW_COACH` and
`INTERVIEW_COACH_RETAIN`. Changing one meant editing a file and restarting `pnpm dev`. The owner
asked for them in the Mac app's Settings.

## What was built

One registry, `BEHAVIOUR_FLAGS` in `packages/interview-contracts/src/behaviour-flags.ts`. Each row
is a flag: its environment variable (which is also its key), its allowed values, its default, the
process that reads it, its label, its help text and a name for each value. Validation, the
Studio's route, the worker's reading and the Settings pane are derived from it.

### Precedence (the same for every flag, in every process)

1. **The environment variable, when the host set it.** It wins. Settings shows the flag as "Set by
   the environment (NAME); change it there" and the control is disabled; the route refuses a change
   with `409 flag_set_by_environment`. An empty variable (`NAME=`) says nothing.
2. Otherwise **what Settings stored**.
3. Otherwise **the host's default**, for a flag that names one (`hostDefaultEnv`; today only
   `INTERVIEW_COACH_DEFAULT`). This is what a launcher starts with, and Settings may change it.
4. Otherwise **the flag's own default**. Every default is what it was: voice activity off, no
   coach, one model session kept.

A set variable is read exactly as the code read it before (voice activity is on only for exactly
`on`; the coach is `claude` or `codex` in any case, anything else is no coach; the coach keeps its
session unless told `off`).

### Where the value is stored

`behaviour-flags.json` in the Studio's data directory (`INTERVIEW_DATA_DIR`), written by
`products/interview/src/backend/behaviour-flags.ts`: one small file beside the coach's plan and
notes, with the same write-beside-and-rename. It holds flag names and values from closed lists,
nothing else.

Why a file and not a table: these flags are the machine's, as their environment variables are, and
the coach they steer is one per machine (its transcript, notes and plan are already this machine's
files, not a tenant's rows). The tenant installation's `settings` record has no write path and
would make a host-wide switch look per-tenant. No migration was needed.

### The route

`GET /api/v1/behaviour-flags` answers every flag as `{ key, value, source, stored, default }`,
where `source` is `environment`, `setting` or `default`. `PUT` takes `{ key, value }` (one flag,
one of its values; anything else is `400 invalid_behaviour_flag`) and answers the whole list. Both
sit behind the `/api/v1` gate like the coach's plan beside them: the API token as a bearer, or a
verified signed-in session; a cross-site browser request is refused.

### The Settings pane

The Mac app's Settings window is the web pane `?panel=settings` shown inside the shell (ADR-0019),
so the flags are added there: `behaviour-flags-setting.tsx`, a "Behaviour" section with one library
`Select` per registry row (label, help as the description, disabled when the environment set it, a
"Not saved" error under the one that failed). It uses only `Divider` and `Select` from
`@oc-tech/omni-ui-components`: no CSS, no inline style, no layout element of its own. Nothing is
drawn until the Studio has answered.

No Swift was changed. No flag is read by Swift code (the only `ProcessInfo.environment` read in
the shell and companion is a test's hardware gate), so nothing needed `UserDefaults`.

## The flags

### Applicable (in the registry)

| Variable | Read by | Values | Default | Was read | Now read | A change takes effect |
|---|---|---|---|---|---|---|
| `ACTIVE_SESSION_VOICE_ACTIVITY` | Studio web process (`live-session/handlers/voice-activity.handler.ts`, through `interview-backend.ts`) | `on`, `off` | `off` | once at start | at every voice-activity report | on the next report. A companion already told `voice_activity_off` sends nothing more for that run: stop and start listening (or start a new session) after turning it on |
| `INTERVIEW_COACH` | agent worker (`coach-loop.ts`, through `flagged-loop.ts`) | `off`, `claude`, `codex` | `off` (`pnpm dev`: `claude`) | once at start | followed while the worker runs | within about 5 s. During a call the coach is restarted and carries on from its ledger |
| `INTERVIEW_COACH_RETAIN` | agent worker (same) | `on`, `off` | `on` | once when the coach started | followed while the worker runs | within about 5 s; the coach is restarted, so a kept model session is given up |
| `INTERVIEW_COACH_GROUNDING` (added 2026-10-10; [[briefs/BRIEF-interview-brief-and-context-pack]] section 15) | agent worker (same) | `on`, `off` | `on` | not read before | followed while the worker runs | within about 5 s; the coach is restarted. `on` is prompt `live-coach-10` with the word check on cited claims; `off` is the coach as it was |

Safety that did not move: a voice-activity report is still told to the coach only for a
`permitted-remote` session (the check in `voiceActivityLocked` is unchanged, and tested with the
setting on); the coach still never reads a device-only session (the Studio does not hand its
words over, whichever runtime is chosen).

### Not applicable (left in the environment)

| Variables | Why |
|---|---|
| `ACTIVE_SESSION_RUNNER_DEVICE_LOCAL`, `AI_LOCALITY`, `OPENAI_LOCALITY`, `LM_STUDIO_LOCALITY` | Declarations about where work runs. A device-only session trusts them, so flipping one from a pane could send its content off the device. They stay a host decision |
| `LOG_CONTENT`, `AI_ENGINE_CAPTURE`, `LOG_LEVEL`, `LOG_FORMAT` | Whether content is written to a log or kept with a run, and operator logging. Content gates stay with the host |
| `ACTIVE_SESSION_AGENT_PORT`, `ACTIVE_SESSION_AGENT_PROFILE`, `ACTIVE_SESSION_AGENT_MAX_TURNS`, `ACTIVE_SESSION_AGENT_STAGING_DIR` | Which executor answers a session and its bounds. The Claude agent runner is the one executor by the owner's rule (OBJ-12); profiles are never a user's input (AGENTS.md rule 7) |
| `ACTIVE_SESSION_AGENT_ESCALATION` | Creates a bounded agent job whose result nothing publishes yet (deferred hand-off in `escalation.ts`); not a behaviour a person would see change |
| `ACTIVE_SESSION_CODE_RUNNER`, `CODE_RUNNER_*` | Wiring: needs Docker and the runner images |
| `INTERVIEW_ASSISTANT_DEFAULT_MODEL` | The assistant's model already has its own picker, which wins over this default |
| `AI_*`, `OPENAI_*`, `LM_STUDIO_*`, `ANTHROPIC_*`, `CLAUDE_*_MODEL`, `CODEX_*`, image-provider variables | Model and provider wiring, keys and URLs |
| `DOCUMENTS_*`, `AGENT_WORKER_*`, `AI_TIMEOUT_MS`, `ASSISTANT_*` | Numeric limits and worker tuning, validated at start |
| `AUTH_*`, `FAKE_AUTH_ENABLED`, `INTEGRATION_*`, every `*_SECRET`, `*_TOKEN`, `*_KEY` | Sign-in, OAuth and secrets |
| `DATABASE_*`, `*_URL`, `*_PORT`, `*_DIR`, `*_PATH`, `PLATFORM_BOOTSTRAP_*` | Addresses, paths and seeding |
| `DEV_SKIP_LM_STUDIO_LOAD`, `E2E_*`, `BENCHMARK_*`, `BUILD_PACKAGED`, `NEXT_*`, `CRUX_*`, `TOOLCHAIN_DIR` | Build, development and test switches |

## How the agent worker learns a stored value

No new channel. The coach already talks to the Studio over its API with `INTERVIEW_API_TOKEN` at
`INTERVIEW_API_URL`; `apps/agent-worker/src/flagged-loop.ts` asks the same API for
`/api/v1/behaviour-flags` every 5 s, fills the worker's flags that the host did not set into the
environment the coach loop is built from, and builds the loop again when they change (stopping the
running one first). `coach-loop.ts` is unchanged: it still reads `INTERVIEW_COACH` and
`INTERVIEW_COACH_RETAIN` from the environment it is given, so a host value it does not know still
gets its own message.

- With no API token, or with every worker flag set by the host, the loop is built once from the
  environment, exactly as before, and the Studio is never asked.
- Nothing is started until Settings has been read once, so a coach switched off in Settings does
  not run for the first seconds after a restart.
- While the Studio cannot be reached the worker keeps what it has.

## Not done, and what is not proven

- **`pnpm dev` still pins the coach.** `scripts/dev.mjs` passes
  `INTERVIEW_COACH: configuredEnvironment.INTERVIEW_COACH ?? "claude"`, so under `pnpm dev` the
  variable is always set and Settings shows "Live coach" as set by the environment. The launcher
  belongs to other work in flight and was not edited here. The one-line change that hands the
  choice to Settings while keeping `claude` as the starting value:
  replace that line with `INTERVIEW_COACH_DEFAULT: configuredEnvironment.INTERVIEW_COACH_DEFAULT ?? "claude",`
  (`...configuredEnvironment` above it already passes a real `INTERVIEW_COACH` through). Until
  then, voice activity and the coach's kept session are changeable in Settings and the coach's
  runtime is not.
- **The real window was not looked at.** The pane is proven with the library's `Select` in jsdom
  (labels, values, disabled state, save, failure). How the three rows sit in the 400 by 380 Settings
  window, and whether the long help lines wrap well there, needs a look in the app.
- **Worker and Studio with different environments.** The pane reports "set by the environment"
  from the Studio's process. Under `pnpm dev` both processes get the same variables; if a worker is
  started by hand with its own `INTERVIEW_COACH`, the worker obeys its own variable while the pane
  shows the Studio's view.
- **A shared host.** The file is the machine's, so any signed-in member can change a flag, as any
  can write the coach's plan. A host with more than one tenant should pin the flags in its
  environment, which makes them read-only.
- No live call was run with the setting flipped mid-session.

## How to add a flag

1. Check it belongs: a closed list of values, safe to flip from a pane, not in the "Not
   applicable" table for a reason that still holds.
2. Add a row to `BEHAVIOUR_FLAGS`: `env`, `process`, `type`, `values`, `default`, `fromEnv` (what a
   set variable means, exactly as the code reads it today), `label`, `help` (say when a change
   takes effect) and `options`.
3. Read it at the point of use through the accessor, never once at start:
   - in the Studio: `behaviourFlags.value("NAME")` (`products/interview/src/backend/behaviour-flags.ts`);
   - in the agent worker: wrap the loop that reads the variable in `flaggedLoop(...)` and build it
     from the environment it is handed.
4. Say in `.env.example` that the flag is also in Settings and that the environment wins.
5. The route, its validation and the pane need no change. The registry test checks every row; add
   the flag's own reading of its variable to `behaviour-flags.test.ts`.
