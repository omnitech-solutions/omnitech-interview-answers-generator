# NATIVE worker report: the macOS app's sign-in and start screens

Base 074b883, master, nothing committed. Scratchpad shots: `.../scratchpad/shots/` (ref-signed-out.png = the design in Chromium; mine-signed-out.png, mine-idle-denied.png etc. = WebKit shim pages; the temp shot spec is deleted).

## Built, per design state
- Signed out (N1): public page `apps/web/app/native/sign-in/page.tsx` mounts `NativeSignInRoute` (`products/interview/src/frontend/native-sign-in-route.tsx`, exported from the frontend entry) which renders `PanelsRoot signedOut`. Same chrome: real `Toolbar` (new `ToolbarLock` context, `toolbar-lock.ts`; each control reads it: `disabled` + title "Sign in first" / "Start a session first"; window dots stay live), `Not signed in` chip, real `Footer` with new `idle` variant. Card: `panels/start-panel.tsx`, CSS `start-panel.css` (imported by panels.css). A tenant route that gets 401 draws the same card with the "Your session expired" banner (N6). `PanelsRoot` replaces the old "Starting..." auto-start (`auto-session.ts` no longer starts anything; keeps consent polling and the panel bus).
- Browser flow (N2): contract `studioHost.account` (capability `account`; `packages/interview-contracts/src/studio-host.ts`), Swift decoder/script/handler (`HostBridge.swift`, `BridgeHandler.swift`), `SignInCoordinator.swift` rewritten (NSWorkspace.open, `application(_:open:)` in AppDelegate, attempt/timeout via `SignInAttempt`, reopen, copy link on the pasteboard; ASWebAuthenticationSession removed). Waiting screen, Reopen, Copy link, Cancel, timed-out notice. `/api/native-auth/complete` now returns the design's "You're signed in" page (button = exact callback, meta refresh, no script, CSP, no-store). Info.plist scheme already registered in `bundle-app.sh`.
- Local (N3): providers route returns `providers:[...]` (`local` only for FAKE_AUTH + loopback via WEB's `localSignInAvailable`); `configured` unchanged. Confirm step with four true facts; Continue signs in inside the web view (csrf + `/api/auth/callback/local`, then session check) and goes to the panel.
- Idle (N4): `start-panel.tsx` Idle: targets (soonest future interview + Rehearsal; local = Rehearsal only) from `useSetupChoices`, Mac permissions via new `account.permissions()` (polled 2.5 s and on focus; app audio follows Screen Recording), "Allow..." opens the Microphone/Screen Recording panes (Microphone address added to the shell's allow-list), agreement checkbox for interviews only, Start gating hints, start request built by the existing `buildStartRequest`, "Set up in Studio on the web" opens the browser.
- Chip/menu/footer/sign-out (N5): chip + menu (Open Studio on the web, Settings, Sign in with Google or LinkedIn (local), Sign out / Sign out of local profile; sign-out hidden when `canSignOut` false). Sign-out = shell clears Studio cookies from the web view, cancels attempt, stops watch and engine, loads the panel with `notice=signed-out` ("Signed out" toast). Menu-bar "Sign out" item (`StatusMenuRules`). Footer status honest ("Not signed in", "Local profile · no account", "Signed in · no live session").

## Tests run (all by me)
- Swift: `swift run studio-shell-tests` 151 passed, 0 failed; `swift build -c release` OK.
- Vitest: `products/interview/src/frontend/studio/live` 128 files / 1912 tests passed (before my last test additions; start-panel 29, start-model 12 pass); `packages/interview-contracts` studio-host tests pass; `apps/web/app/api/native-auth` 7 passed; `apps/web/app/native` 2 passed; `pnpm exec vitest run scripts` 20 files / 99 passed (export-surface record raised: interview-contracts 373, product-interview 83).
- e2e WebKit (`E2E_DIST_DIR=.next-e2e-native`): `native-signin.spec.ts` 11 tests + `native-host.spec.ts` + one temp shot spec: 19 passed. Regression run (webkit, 112 tests: all `*native*` specs, capture-*, cross-surface-sync, shortcuts, screenshots-*): 109 passed, 3 skipped, 0 failed, so the live UI specs are unchanged in behaviour.
- Claims: 17 native rows added (claims.ts block before COVERED_BY) and 6 scan states added to `scan-states.ts`; claims-coverage.spec (chromium): 4 passed (native scan includes the new states; 1 native claim pending: the agreement checkbox, unit-covered only).

## UNVERIFIED
macOS app never launched: NSWorkspace open, URL-scheme callback, cookie deletion, AVCaptureDevice mic state, pasteboard, status-menu item are compiled, not exercised. App audio permission mirrors Screen Recording (assumption). `route-classification` passed in the guard run.

## Owner decisions / deviations
1. Footer in no-session states has no Pause/End (the screenshots show none), not disabled copies. Say if you want them drawn disabled.
2. Rehearsal needs no "everyone has agreed" checkbox (design); interviews do. Setup page requires it for both. This is the one consent-semantics choice.
3. Menu label "Link a Google or LinkedIn account" became "Sign in with Google or LinkedIn" and "Reset this Mac" became "Sign out of local profile": accounts are separate identities (nothing merges) and nothing is cleared.
4. Expired copy omits "after 30 days"/"Nothing on this Mac was lost"; sign-out is this Mac only (stateless JWT cannot be revoked remotely).
5. In a development Studio (bypass) every request is authenticated, so sign-out clears nothing visible there.
6. Added bridge ops signIn, cancelSignIn, reopenSignIn, copySignInLink, signOut, permissions (new contract surface, +8 exported names).

## Files changed (mine)
apps/studio-shell: HostBridge, NativeSignIn, ConnectionState, AppDelegate, BridgeHandler, ShellModel, SignInCoordinator, StatusMenu, StudioWebView, new ShellPermissions; tests BridgeDecode/BridgeScript/BridgeTrust/NativeSignIn. apps/web: api/native-auth/{providers,complete} + test, app/native/sign-in. packages/interview-contracts studio-host(+test, index). products/interview overlay: start-panel(.tsx/.css/.test), start-model(+test), start-icons, use-account, toolbar-lock, toolbar, popover, overlay-footer, overlay-page, panels-root, auto-session, glass-guard.test, signed-out.test, panels.test; frontend index + native-sign-in-route. e2e: host-shim, scan-states, claims.ts (block), native-signin.spec (new), native-host.spec. scripts/export-surface.test.ts (2 numbers).

## Needed from others
Nothing. Note `products/interview` and `interview-contracts` dist were rebuilt (`pnpm build` in each) for the e2e stack.
