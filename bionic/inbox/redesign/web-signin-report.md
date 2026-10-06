# WEB worker report: web sign-in, signed-out and account flows

Base 074b883, nothing committed. All results below are from runs in this session.

## Built (file)
- W1 server rules: `apps/web/src/platform/fake-auth.ts` (`isLoopbackHost`, `localSignInAvailable`, `allowLocalSignIn`: FAKE_AUTH_ENABLED and a loopback Host, off when X-Forwarded-Host/For names a non-loopback origin); `apps/web/auth.ts` (local `authorize` refuses a non-loopback request, closes the easy path of AU-SEC-02); `apps/web/src/platform/return-target.ts` (`safeReturnTarget`, `signInPath`, `withSignedInMarker`, `returnTargetLabel`); `context.ts` `refuseTenantAccess(next?)` redirects to `/sign-in?next=...`; `apps/web/proxy.ts` + `request-path.ts` record the requested path as a header so the tenant layout (which is not told its path) can carry it; product page passes its own path.
- W2 `/sign-in`: `apps/web/app/sign-in/{page,sign-in-view,actions,last-used}.tsx`, CSS `.auth-*` in `apps/web/app/styles.css`. Dark default, light via prefers-color-scheme, page paints its own html/body background. Unconfigured provider = disabled with reason. Local button, divider and note only when `localSignInAvailable`. "Last used" from localStorage `studio.last-provider`, written only by the welcome banner after a fresh sign-in.
- W3 `/signed-out`: `apps/web/app/signed-out/*` (scope sentence differs for local vs account).
- W4/W5/W6 studio: `products/interview/src/frontend/studio/account/*` (menu, sign-out dialog, sign-out helper, welcome banner, css), wired in `sidebar.tsx`, `studio.tsx`, `studio-page.tsx`, `tokens.css` (one @import).
- Claims rows: `e2e/live-session/src/claims/claims.ts` (8 rows).

## Tests run (counts)
- `apps/web` vitest: 25 files, 225 tests pass. `products/interview` studio account + sidebar: pass; full `src/frontend`: 2137 pass, 2 fail, both in NATIVE's overlay panel tests (panels.test.tsx, signed-out.test.tsx), not mine.
- `scripts`: all pass except export-surface: `interview-contracts` 373 vs 365 recorded (NATIVE's studio-host growth; they must raise it). I raised `platform-contracts` 22 -> 23 (ProductMember, already on base, was unrecorded).
- Chromium e2e (E2E_DIST_DIR=.next-e2e-web): web-signin-page 7/7, web-account 5/5, smoke-web-end, shortcuts, web-band, session-lifecycle-web 34/34; claims-coverage 3/4 (the native scan fails on NATIVE's new controls "Account: This Mac", "Start session", etc.). WebKit smoke-web-signin passes.
- Tests were written before code for return-target, fake-auth, refuseTenantAccess (seen red); auth.test.ts and the studio account tests were written alongside the code.
- Updated `smoke-web-signin.spec.ts` (expected the old 404 and text "Local user"; now expects the redirect to sign-in and the Account button).

## Screenshots (scratchpad/shots)
ref-login.png vs real-login.png (dark), real-login-light, real-expired, real-welcome, real-menu, real-dialog, real-signedout. Layout matches; fonts and top offset differ slightly (no fake browser chrome).

## UNVERIFIED
- Live-session UI untouched, but I did not diff pixels of the locked live view.
- Host header is client-supplied: loopback check is a statement about the requested address; a remote client forging Host with no proxy would pass. Real peer address is not available in Next handlers.
- Light-variant look not compared with a design reference (none exists).
- Full `pnpm verify`, native Swift: not run (forbidden/not mine).

## Owner decisions
1. "Sign out everywhere" not shipped: JWT sessions cannot be revoked; only "this browser". Dialog and signed-out copy say other devices and the Mac app keep their own sign-in.
2. No Settings, Devices, Keyboard shortcuts items: no such destinations in the studio. Menu has Connected accounts (existing page), "Sign in with an account" (local only; it is a different identity, not a merge, so not worded "Link"), Sign out.
3. No "Signed in with Google" row or provider name: the session does not carry the provider.
4. Expired-session re-auth dialog (W7) not done.
5. `proxy.ts` is a new tiny Next proxy on `/t/*` (sets one request header); alternative is to drop it and lose the deep link for layout-level refusals.

## For others
- NATIVE: `localSignInNeeded()` unchanged; `/api/native-auth/start` uses the local provider, which now needs a loopback Host. Raise export-surface record for interview-contracts; claims rows for the new native controls.
- Product dist must be rebuilt (`pnpm build` in products/interview) before e2e; I ran it there and in platform-contracts.
