# Rules for every native-rework worker (read fully; your prompt adds only your track)

You are one worker on the Interview Studio native-app UI rework: replace the old panel/toolbar/footer UI with the shared
component library `@oc-tech/omni-ui-components` (0.1.0, already installed from `vendor/`) so the app matches the committed
design, with ALL existing behaviour kept. Read, in this order: `AGENTS.md`, then
`bionic/inbox/redesign/native-ui-swap-plan.md` (the contract: the two rules in section 0, the behaviour contract in
section 4, your requirement ids and acceptance checks in 4A, the old-to-new map in section 5, new data in section 7),
then `bionic/inbox/redesign/native-rework-2h-plan.md` (tracks and file ownership). The design target is
`bionic/inbox/redesign/ui-components/design/board-1a/1c/1d/1e.png` and `Native-Panel-Cleanup.dc.html`: open the board for your
surface and match it.

Owner decisions: the transcript panel is 330 px wide (minimum 300); hiding the Code panel does NOT change what the Answer
panel shows; the library's history button reads "Load previous messages".

## The two rules
1. Old UI goes: once your surface renders through library components, delete the old component code and its CSS (class
   families `pn-*`/`ov-*`/`studio-*` that only your surface used). Do not leave dead code or a second copy.
2. Behaviour stays: every behaviour of the old component (section 4 of the swap plan, plus anything its tests assert) still
   works. Before changing a component, write down its behaviours and make sure a test covers each (add the missing ones against
   the OLD component first, commit that, then swap). Never loosen an existing assertion; update selectors from `.pn-*`
   classes to roles, titles and `data-slot`.

## The library (props only)
Icons are `ReactNode` props; user-visible strings go through `labels` props (`DEFAULT_<X>_LABELS` are exported); callbacks are
plain optional `on*` props that receive the full item first; an absent callback means the control is not rendered; portalled
content takes a `container` prop and carries `data-oui-surface` (already in the app's hit-region selectors); styling is
`--oui-*` tokens (dark and light follow the page's `data-theme`; `--oui-panel-see-through` is set by `ui/theme.css` from the
panel glass, backgrounds only). Entry points: `.`, `./native`, `./chat`, `./highlight`, `./styles.css`. Read a component's
types before using it: `node_modules/@oc-tech/omni-ui-components/dist-types/<Component>/*.d.ts` (in the app's `apps/web`
dependency tree) or the source in `~/dev/omnitech-solutions/omni-ui-components/packages/core/src/<Component>/`; its Storybook
stories there show the exact board layouts (Native App showcase: Window 900/1180, Toolbar States/Variations, Panels In Three
States, Footer States). If the library lacks something you need, keep an app-owned wrapper that uses library tokens and
`Button`/`IconButton`, record the gap in your report, and do not change the library.

## Git and machine rules (strict)
- Work ONLY in your own worktree: `cd ~/dev/omnitech-solutions/omnitech-interview-answers-generator && git worktree add -B ns/<track> ../wt-ns-<track> native-swap && cd ../wt-ns-<track> && LEFTHOOK=0 pnpm install --frozen-lockfile && pnpm exec turbo run build --filter='./products/interview^...'` (workspace packages must be built before vitest works in a fresh worktree). Never run `lefthook install`.
- Commit small, with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. The repo's pre-commit hook runs `biome check` on staged files: fix what it reports, never bypass it. Push ONLY your branch with `LEFTHOOK=0 git push origin ns/<track>` (the full gate runs when the manager merges; do NOT run `pnpm verify` or `pnpm test:coverage`; do NOT use `--no-verify`). Never touch `native-swap` or `master`.
- The machine is shared by up to 6 workers: run only TARGETED tests, e.g. `pnpm exec vitest run <files or dir>` (node/react projects; skip the Docker-backed projects), and `pnpm exec tsc --noEmit -p <package tsconfig>` for the packages you touched. No dev server, no Docker stack, no Storybook. Wrap long commands with `perl -e 'alarm 900; exec @ARGV' ...`. No loops: if a command fails twice for the same reason, stop and report instead of retrying.
- Stay inside your files (the ownership table in the 2h plan). Shared files (`ui/theme.css`, `studio/tokens.css`, `toolbar-config.ts`, `panels.css`, `overlay.css`) are not yours unless your prompt says so; for `panels.css`/`overlay.css` delete only the rules of the classes your surface no longer renders, and keep both sides on any conflict. Do not reformat unrelated code. New files follow the repo's Biome style (double quotes, 2 spaces, width 80).
- Never log or print secrets; never log questions/prompts/generated content (AGENTS.md rule 8).

## Report (plain text, honest)
1. Files changed/created/deleted. 2. Behaviours found in the old component and the tests that cover each (added vs existing).
3. Requirement ids now satisfied and how you checked each against the board (state differences). 4. Targeted test and tsc
results with counts. 5. What you could NOT verify (the macOS shell, hit regions with portals, cursors, drag, see-through at
runtime, anything needing the running app) and what the owner must check. 6. Library gaps and anything you did not finish.
Do not claim anything you did not run.
