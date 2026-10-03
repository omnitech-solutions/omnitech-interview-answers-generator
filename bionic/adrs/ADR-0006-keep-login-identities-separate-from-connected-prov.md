---
id: ADR-0006
title: "Keep login identities separate from connected provider accounts"
status: Proposed
date: 2026-10-02
proposed_date: 2026-10-02
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [identity, oauth, security, integrations]
related_briefs: []
related_research: [concepts/platform-architecture]
---

# ADR-0006 — Keep login identities separate from connected provider accounts

## Context

Users sign in with Google or LinkedIn through Auth.js in the shell. Products
also act on providers on a user's behalf (for example LinkedIn connection
data), which needs broader scopes, refresh tokens, and a tenant context that a
login grant does not carry. The identity and integration flows are described
in [[research/concepts/platform-architecture]].

## Decision

1. **Two purposes, two grants.** A login identity proves who the user is. A
   connected account separately authorizes provider actions. Login tokens are
   never reused for product integrations.
2. **Connected-account flow.** A connected account is granted through its own
   OAuth flow, owned by `platform-integrations`, that:
   - uses a separate OAuth client from login;
   - binds HMAC-signed, expiring state to the provider, user and tenant, and
     rejects invalid, expired or cross-tenant callback state;
   - revalidates tenant membership on callback;
   - stores access and refresh tokens encrypted at rest (AES-256-GCM, in
     `platform-storage`) with explicit scopes and expiry metadata;
   - never exposes a token to the client.
3. **Failure.** An OAuth configuration failure returns 503 before redirect.
4. **Scope gating.** A provider feature that needs provider approval (LinkedIn
   connection data) stays disabled until that approval and its scopes are
   confirmed; the base integration requests OIDC profile data only.

## Consequences

**Positive:**
- Sign-in stays low-privilege; integrations are explicit, tenant-bound and
  individually revocable.

**Negative:**
- Each provider needs a second OAuth client and a second consent flow.
- Encrypted token storage adds key management to operations.

## References

- `packages/platform-integrations/src/oauth.ts` (state signing and validation).
- `packages/platform-storage/src/connected-account-vault.ts` (encrypted token storage).
- `apps/web/app/api/integrations/[provider]/authorize/route.ts` and `.../callback/route.ts`.
- [[research/concepts/platform-architecture]]
