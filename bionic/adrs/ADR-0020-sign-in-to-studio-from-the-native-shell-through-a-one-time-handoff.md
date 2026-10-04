---
id: ADR-0020
title: "Sign in to Studio from the native shell through a one-time handoff"
status: Proposed
date: 2026-10-04
proposed_date: 2026-10-04
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0019]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, native, auth, oauth, privacy]
related_briefs: []
related_research: []
---

# ADR-0020 — Sign in to Studio from the native shell through a one-time handoff

## Context

ADR-0019 keeps the native shell's web view on Studio's origin and opens every other link in the browser. A real login provider (ADR-0006: Google or LinkedIn through Auth.js) is therefore unreachable from the shell: the person would sign in in the browser, and the web view would stay signed out. The shell's privileged bridge must not host a provider page, and ADR-0006 keeps login identities separate from connected provider accounts.

## Decision

1. **Default needs no sign-in.** With the default development user, or any Studio that reports the person signed in, the shell never prompts. "Sign in to Studio" appears only when Studio reports the web view unauthenticated and Studio reports a real login provider configured.
2. **The provider never runs in the web view.** Sign-in runs in a system web-auth session opened only at Studio's own start URL. A web view navigation to Studio's sign-in page or a known login provider starts that round trip instead of loading. Other external links still open in the browser.
3. **The callback carries no session.** Studio answers the completed sign-in with a handoff code on a callback scheme owned by the app bundle, and nothing else. The code is short-lived (60 seconds at most), single use, held only as a hash, and bound to the shell's pending attempt and to Studio's origin; replay, expiry, a wrong attempt, and a wrong origin are refused, and a refused presentation spends the code.
4. **Redemption happens in the web view.** The shell loads Studio's redemption URL in the web view; Studio verifies and consumes the code and sets its own session cookie there.
5. **Login only.** The handoff code authorises Studio login and nothing else. It is never a provider token, never derived from or exchanged for one, and never touches connected accounts or integration tokens (ADR-0006). The paired capture credential in the Keychain is not involved. Nothing in the round trip is logged.
6. **Session end repeats the round trip.** An expired or signed-out session returns the shell to the sign-in-required state; Disconnect still erases the web view's data and abandons any attempt in flight.

## Alternatives Considered

### Option A — Host the provider in the web view
- **Pros:** No callback scheme.
- **Cons:** The identity provider page runs beside the privileged bridge; providers increasingly refuse embedded web views.
- **Why not:** It breaks the isolation ADR-0019 set.

### Option B — Put the session token in the callback URL
- **Pros:** No redemption step.
- **Cons:** A long-lived credential in a URL another process can register for.
- **Why not:** A one-time code costs one request and leaks nothing reusable.

## Consequences

**Positive:** Real login works in the shell with the system's cookies and passkeys; the default path is unchanged.

**Negative:** The handoff store is in process memory, so a Studio restart drops a pending handoff and a multi-instance deployment needs a shared store. The live round trip with a real provider is unobserved here.

## References

- [[adrs/ADR-0019-host-the-overlay-in-a-native-shell-through-one-host-adapter]]
- [[adrs/ADR-0006-keep-login-identities-separate-from-connected-provider-accounts]]
