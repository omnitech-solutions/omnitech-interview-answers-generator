---
title: "The Mac app is rebuilt by pnpm dev, beside the servers"
slug: native-app-rebuilt-on-dev
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [dev-launcher, native, studio-shell, signing]
related_adrs: [ADR-0002, ADR-0019]
---

# The Mac app is rebuilt by pnpm dev, beside the servers

## Problem

Agents change Swift code in `apps/studio-shell` and `apps/capture-companion/macos`, and the owner
then runs a stale app: a native change needed `swift build -c release && scripts/bundle-app.sh` by
hand, then a copy to `~/Applications/Interview Studio.app`. On 2026-10-09 the installed app was the
build of 2026-10-07. The owner's rule: "on pnpm dev we always rebuild the app but make it not block
running the main web app."

## What pnpm dev did

`scripts/dev.mjs` loads the environment, then blocks on four steps (Postgres in Docker, roles and
migration, storage bootstrap, the build of every package the web app loads), then starts the web
app, the terminal gateway and the agent worker together, and `tsc -b --watch`. It did nothing
native. It does not open the app, and still does not.

## What it does now

Before its first blocking step `scripts/dev.mjs` starts `scripts/dev-native.mjs --watch` as its own
process, with the terminal as its output, and never waits for it or reads its exit code.

| Step | When | Cost |
|---|---|---|
| Fingerprint | Every start, and one second after a Swift file is saved | 6 to 80 ms. A SHA-256 of the paths and contents of the two `Package.swift` files, both `Sources` trees and `bundle-app.sh`, and of the build recipe |
| Compile | The fingerprint differs from the stamp's `compiled` | `nice -n 10 swift build -c release --product studio-shell`: 55 s cold, 4 to 16 s after an edit. Safe at any time: it writes only `.build/release` |
| Apply | The fingerprint differs from the stamp's `applied`, and no `studio-shell` process is running | About a second: `scripts/bundle-app.sh` (unchanged), then, when `~/Applications/Interview Studio.app` exists, a copy beside it, `codesign --verify --strict`, and a swap by rename |

The stamp is `.dev-local/native-app/stamp.json` (gitignored). The decisions are plain functions in
`scripts/native-app.mjs`, tested with invented effects in `scripts/native-app.test.ts`.

Rules that came from the owner's constraints:

- **A running app is never touched.** Not stopped, not restarted, and its bundle is not replaced on
  disk (he may be in a live call). The compile still happens; one line says to quit and reopen.
  While `pnpm dev` runs, the held build is installed within three seconds of the app quitting.
- **A failed build never fails dev.** It prints the compiler's error lines (eight at most), the log
  path and `pnpm dev:native`, and the watcher waits for the next save.
- **Only the app's product is built**, so a broken test target cannot hold the app back.
- **An app is never put on a machine that has none installed.** Without a copy in `~/Applications`
  the fresh bundle stays at `apps/studio-shell/.build/InterviewStudioShell.app`.
- **Off switch:** `DEV_NATIVE_BUILD=off`. Off macOS it prints one line and stops; without a Swift
  toolchain it prints one line when a build is needed.

## Why the output is not piped through the launcher

The launcher's setup steps are `spawnSync` calls, which block its event loop: a child whose output
it piped would have nothing reading the pipe for that time. The native task prints its own
prefixed lines to the terminal and keeps the compiler's output in its own log, so its lines are not
in `.dev-local/dev.log`.

## Signing and the macOS privacy grants

- `apps/studio-shell/scripts/bundle-app.sh` signs ad hoc (no signing identity is installed on the
  owner's machine) with an explicit designated requirement, `identifier
  "com.omnitech.studio-shell"`. A plain ad-hoc signature's requirement is the code hash, which
  changes with every build, so macOS treated each rebuild as a different app and dropped its
  Screen Recording, Microphone and Speech grants. The explicit requirement is the same for every
  build. The dev task runs that script as it is and copies the result with `ditto`; a build made
  and installed by the task was checked to carry the same requirement and a valid signature.
- Not measured here: that the grants do in fact survive on this macOS. That needs the app to be
  quit and reopened on a new build, which the task will not do for the owner.
- The script's header and the README still said macOS asks again after each rebuild; the README is
  corrected, the script is unchanged.
- `apps/capture-companion/macos/scripts/bundle-app.sh` (the standalone companion bundle) still
  signs with a plain ad-hoc signature and would lose its grants on each rebuild. The dev task does
  not build that bundle: the app compiles the companion's modules into itself.

## Not built

- Opening the app from `pnpm dev`. It never did; the owner opens it.
- Replacing the bundle of a running app by rename. The running process would keep its files, but
  what macOS does when it next checks the code of a running app whose bundle was swapped was not
  established, and a live call is the wrong place to find out.
- The build id in the About panel is the commit at build time. A commit that changes no Swift
  source does not rebuild, so the id can be older than `HEAD` while the code is the same.
