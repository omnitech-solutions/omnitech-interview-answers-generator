# SEC report (wave 1)

## PKCE (Cross-cutting 10 / Q10)
- `packages/platform-integrations/src/oauth.ts`: `createPkcePair` (32 random bytes, S256), `pkceCookieName`, `verifierFromCookie` (constant-time match of the cookie's verifier to the challenge in the signed state); `pkce` capability on `OAuthProviderConfiguration`; `createAuthorizationUrl(..., pkceChallenge?)` adds `code_challenge` + `code_challenge_method=S256`; `exchangeAuthorizationCode(..., codeVerifier?)` sends `code_verifier` and throws "The PKCE verifier is missing." for a PKCE provider without one; state schema gains optional `pkceChallenge`.
- Binding: verifier lives ONLY in an httpOnly, SameSite=Lax, Secure-on-https cookie `integration_pkce_<provider>`, Path=`/api/integrations/<provider>/callback`, Max-Age 600. The URL and state carry only the challenge. Chosen over putting it in the state because the state travels in the URL.
- `authorize/route.ts` sets the cookie; `callback/route.ts` refuses 403 before any token request if the cookie is missing/wrong/from another attempt or the state has no challenge; it clears the cookie on every outcome (so the same callback URL cannot be replayed for a PKCE provider) and now maps a failed exchange to 502 (was an unhandled throw).
- Google: PKCE on (documented). LinkedIn: off by default, opt-in `INTEGRATION_LINKEDIN_PKCE=1` (documented in `.env.example`). **UNVERIFIED**: LinkedIn web-client PKCE support (docs not captured offline).
- Rule 6/8: no login token reuse; the verifier is never logged or in a URL; tokens still encrypted by the vault, nothing new reaches the client.
- Tests: `oauth-flow.test.ts` (+6), `oauth.test.ts` (+3), authorize `route.test.ts` (+3), callback `route.test.ts` (+5 cases).
- Note: state replay inside its 10 minutes is still possible for a provider WITHOUT PKCE (LinkedIn default); it is bounded by the single-use provider code.

## HO-SEC-02 (`/api/v1`)
Callers found: the signed-in web UI (`studioFetch`, which names the tenant in `x-omnitech-tenant`), the CLI and `interview-api-client` (bearer token + tenant header, default tenant `local`), `interview-playground-control`.
Decision (KEEP and HARDEN), `products/interview/src/backend/api.ts` (`authenticate`, `bearerMatches`, `browserSaysCrossSite`):
1. Bearer `INTERVIEW_API_TOKEN` compared via `timingSafeEqual` on SHA-256 digests (equal length).
2. Otherwise a verified session: new `InterviewApiOptions.verifySession(request)`; wired in `interview-backend.ts` to `services.resolveContext(<tenant header or ?tenant=>)` being non-null (the header is a lookup key, the session cookie is the proof; no tenant means no session). A throwing verifier means no session.
3. `Origin`/`Sec-Fetch-Site` never grant access; they only narrow the session path (cross-site marked requests are refused).
4. Unset token = bearer path CLOSED (was: fully open). A non-browser caller without a session gets the fixed 401 "A valid API token or signed-in session is required." Consequence: a CLI needs `INTERVIEW_API_TOKEN`, except under the host's local sign-in bypass where `--tenant local` (the CLI default) resolves without a cookie. Documented in `.env.example`. The token path is an operator credential with no tenant membership (route-classification reasons updated).
- Two plain `fetch` calls to `/api/v1` carried no tenant, so they would have lost the session: small targeted edits switched them to `studioFetch` (`products/interview/src/frontend/library.tsx:43` area, `products/interview/src/frontend/studio/use-playground-control.ts` poll). Both are in files I do not own.
- Tests: `api.test.ts` gate block (token ok; wrong/longer/non-bearer/none refused; spoofed Origin and Sec-Fetch-Site refused with and without token; no-token closed; no verifier wired; session ok; cross-site refused; throwing verifier) plus `interview-backend.test.ts` (no tenant, unknown tenant, spoofed headers all 401; member ok).

## HO-SEC-03
`api.ts`: `x-request-id` echoed only if `^[A-Za-z0-9._:-]{1,255}$`, else a generated UUID. Tests: 255 ok, 256, empty, spaces, non-ASCII replaced.

## Runs
- `pnpm exec vitest run` platform-integrations + integrations routes + api.test + interview-backend.test + route-classification + env-docs + web-thinness + library/studio-page frontend: all pass. The whole `products/interview/src/backend` dir ran green before my last edits (123 files; only the two since-fixed tests failed).
- `tsc --noEmit`: platform-integrations, products/interview, apps/web clean.
- `scripts/` guards still failing, NOT mine: `export-surface` (interview-contracts 373 vs 365, product-interview 83 vs 82), `route-classification` (`ALL /api/*` unclassified), `rls-role-guard` (x2). I raised the platform-integrations record 9 to 12 (small edit in `scripts/export-surface.test.ts`).
- Not run: browser e2e, `pnpm verify`.

## Wave 2 / ADR
- Root `/api/*` guard / onError (HO-SEC-01, HO-ERR-01) not touched. If WEB adds a shared origin guard, `/api/v1` already handles its own.
- ADR text suggested (GOV, 25 lines max): Context: `/api/v1` was open when the token was unset and trusted client headers. Decision: bearer (constant-time) or verified tenant session, headers only narrow, unset token closes the bearer path. Alternatives: retire the surface (CLI depends on it); make the token mandatory (breaks local dev). Consequences: CLI needs a token or the local bypass. Second: S256 PKCE with verifier in an httpOnly callback-scoped cookie, challenge in the signed state, per-provider capability.
