# Native Panel Cleanup: the designer's gallery (the target for the native app)

`Native-Panel-Cleanup.dc.html` is the designer's gallery (open it in a browser). `board-1a.png` (top toolbar states),
`board-1c.png` (merging "Manual" into capture, caret menus), `board-1d.png` (panels in three states) and `board-1e.png`
(footer) are 2x crops of its boards. Board 1b (a Zoom-style variant) is ignored and 1f (sensor icons in the footer) is
dropped by the owner, so neither is included.

The written requirements (T1–T9, M1–M11, F1–F6) are in `../native-panel-cleanup-brief.md`, verbatim. The
requirement-by-requirement acceptance table is in `../../native-ui-swap-plan.md` (section 4A).

Caveat: the boards draw the shortcuts as `⌘⇧S`, `⌥⇧U` and so on. The app's real bindings (`panels/commands.ts`) are the
contract, not the glyphs in these images.
