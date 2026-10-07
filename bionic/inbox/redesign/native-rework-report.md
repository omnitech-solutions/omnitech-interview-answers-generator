# Native rework: overnight report (2026-10-07)

Written for the owner. Everything below says what was RUN and what was only read. "Verified" means I ran it on the final tree;
"unverified" means I could not.

## 1. Where things are

| Thing | State |
|---|---|
| App `master` | `ebd583b`, pushed to origin. Passed the pre-push gate (`pnpm verify`, 452 s). |
| Installed app | `~/Applications/Interview Studio.app`, build id `ebd583b+` (the `+` = an untracked file in my working tree, nothing else). Ad-hoc signed: macOS asks for Screen Recording again. |
| Web half | Rebuilt from `ebd583b` with `pnpm app:up`; web, terminal-gateway and Postgres containers healthy at `127.0.0.1:3000`. |
| Library `@oc-tech/omni-ui-components` | `0.1.0` published (you ran `pnpm publish:package`; `npm view` shows it as `latest`). Library `master` `b184a02`+, gated. The app consumes the vendored tarball (`vendor/omni-ui-components/…-0.1.0.tgz`), same source, built separately (different checksum). |
| Worktrees | All worker worktrees removed (about 8 GB). Unfinished work saved on branches `lib/U43-a11y` and `lib/U46c-primitives-tests`. Your own worktrees untouched. |

## 2. Evidence (final gate, run through the pre-push hook)

- `pnpm verify` = `verify:core` + the browser suite. Total 452 s.
- Unit and component tests: 469 files, 5,472 tests passed (1 file / 2 tests skipped). Coverage 92.7% statements, 85.6% branches, 93.5% functions, 94.5% lines (thresholds 80 and 90).
- Lint, format, typecheck, build: green. Native: `verify-native: ok` (swift-format, SwiftLint, Swift builds, 165 + 67 harness tests, Swift coverage gate).
- e2e: 4 shards in 299 s, exit 0 on all four: 349 passed, 3 skipped, in Chromium and WebKit. The new `panel-layout` spec is in it.
- Library (earlier, same night): 224 files, 2,096 tests, coverage 91.7 / 86.1 / 87.8 / 93.3; Storybook tests 823; visual tests 10.
- Migration audit (`scripts/ui-migration-audit.test.ts`, runs in `verify`): zero legacy imports, selectors and strings; raw-element allow-list (155 buttons) with a reason per entry.
- Walkthrough (QA script, chromium): web home, workspace, briefings, documents, knowledge, rehearsal, live setup, each in dark and light at 1180 and 900 px, plus a click of every visible control: no horizontal overflow anywhere, no page errors. Native panel at 1320 and 900 in both themes: every pane combination, the capture / microphone / answer-style / shortcuts menus, See-through, composer, paused, End confirmation, ended. 84 screenshots in `.dev-local/walkthrough/` (gitignored), results JSON beside them. I looked at the screenshots; they match the design boards.

## 3. What changed

- Native surfaces on the library: toolbar (split capture, mic with device/retry/badge states, grouped answer styles, one panel-toggle group, See-through, grouped shortcuts), footer (`SessionBar` + `StatusClock`, paused = amber timer + one Resume), transcript and composer, answer pane + "To apply" dock, code panel, start panel, popovers, ended card, mini player. Studio pages use the library `Button`.
- Deleted: the old button module, its tokens and tests, the old panel CSS, Picture-in-Picture and the whole in-tab overlay card (about 12,900 lines). `overlay.css` went from 1,777 to 36 lines.
- New data contracts for the toolbar (mic devices/status, persistent screen problems, build tag, grouped styles and shortcuts, capture chips). The Swift shell does not send the mic device list or retry attempt yet; the UI degrades to a plain "Retry now".
- Drag/cursor contract with Swift: the page now publishes `data-drag-chrome` and `data-text-surfaces` (same pattern as `data-hit-surfaces`); the Swift probe reads them and falls back to updated lists.
- Tooling: Biome (format + lint, tiered), lefthook pre-commit (Biome + Swift jobs on staged files) and pre-push, SwiftLint + swift-format, Swift coverage gate (CaptureCore 95%, StudioShell core 84%), e2e inside `pnpm verify`, 20 s per-test e2e timeout (10 s actions), library Biome + hooks + 80% coverage.

## 4. Real bugs found by testing, and fixed

1. The End-session confirmation popover painted UNDER the panels and could not be clicked (`.pn-root` was `position: fixed` at z-index 2147483000; library popovers portal to `<body>` at z-50). Fixed: `.pn-root` z-index 0, with a test.
2. The "To apply" dock thumbnail lost its "Display 2 of 3" label. Fixed.
3. The Code panel shrank to a short, narrow card with empty space beside it. Cause: I deleted the `.pn-analysis` wrapper rule during a merge (my search for its users hid the line that held it). Found by the walkthrough screenshots; fixed; new real-browser test (`panel-layout.spec.ts`) fails without the rule (3/3) and passes with it (6/6).
4. `openSizeMenu` flake: a key pressed right after a menu closed was taken by the closing menu. Fixed in the helper (20/20 over repeats); the same race exists for a person pressing keys very fast (the library's focus-return).
5. Test-suite breaks from the Swift reformat and new exports (shortcut-parity regex assumed one binding per line; export-surface record; env-docs). Fixed.

## 5. Mistakes I made (and fixed)

- Stopped the app's own Postgres container while cleaning up leaked e2e databases (my filter matched its image). Restarted within about a minute; volumes intact; healthy.
- Deleted the `.pn-analysis` rule (item 3 above).
- Misread "finish the work from there" and started the native rework before the Biome work; reverted.
- Let workers run too many e2e loops early on; two killed.

## 6. NOT verified, and why

- **The real macOS window.** The Mac's screen was locked all night (`CGSSessionScreenIsLocked`), so I could not launch or click the installed app (Screen Recording and Accessibility looked available; I can't unlock). Everything the native window does through the web view was tested in WebKit/Chromium with the host shim; what only the real window can show was not.
- Periphery (Swift dead code): not run (needs a toolchain that can index; Xcode licence unaccepted).
- GitHub CI: not run or checked (you said you do not care). CI's `verify` job now runs `verify:core`; its `e2e` job runs the browsers.
- Visual match to the boards was judged by eye on screenshots, not pixel-diffed.

## 7. Your morning checklist for the native window (about 10 minutes)

Launch `~/Applications/Interview Studio.app` (grant Screen Recording when asked), sign in "on this Mac", start a session, then:
1. Drag the window by an empty part of the toolbar and of the footer; buttons must still press, not drag.
2. Hover text in the transcript, answer, code and notes: I-beam cursor, selecting does not move the window.
3. Open every toolbar menu (capture caret, mic caret, answer style, shortcuts, the green dot): each opens, is clickable, and closes with Esc.
4. Press the footer End: the "End this session?" popover appears ABOVE the panels and both buttons work.
5. See-through at 100 / 60 / 22: text stays crisp; toolbar and footer still drag; undrawn glass passes clicks through.
6. Pause, then Resume: panels hide and return, timer excludes paused time.
7. Window modes (green menu hover: Normal / Mini / Full), quit confirmation.
8. Settings window opens; mic muted / lost states if you can provoke them.

## 8. Decisions waiting for you

- **ADR-0033** (remove Picture-in-Picture and the in-tab card) is `Proposed`; it amends ADR-0017. Accept it, and decide whether to retire ADR-0017's "one overlay route any host" rule.
- **Clearing session memory (Alt+Shift+C) now gives no visible feedback** (the transcript system line was removed by requirement M1). Add a toast or chip?
- `GET …/sessions/current` returns 404 when there is no session (by design); the browser logs a console error on every poll. Change it to 200 `{ session: null }`? (Contract change, many tests.)
- The browser Studio live page lost its capture band (ADR-0033). The hands-free controller is still mounted there, so with Auto on in a browser it can start listening with no UI to stop it. Trim it?
- Stale copy: the Sources tab still says "Use Capture & analyze to share a window or screen."
- 155 raw `<button>`s remain on the audit allow-list (native: answer-dock, Settings window, consent button, status strip); porting them is a follow-up.
- Library gaps recorded by the workers: `ActionMenu` rows cannot hold a thumbnail or a status dot; `Transcript` has no per-entry selected state; `SegmentedPrimitive` does not forward `aria-label`; `Toolbar` has no `data-*` passthrough; `IconButton` tooltips have no `container`.
- Knip is installed report-only (about 40 unused exports left as cosmetic); say if you want it in CI.
- crux-flow adoption: planned for after this (about 1 to 1.5 hours; needs an ADR amending ADR-0001).
