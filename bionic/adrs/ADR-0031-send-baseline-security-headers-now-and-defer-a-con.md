---
id: ADR-0031
title: "Send baseline security headers now and defer a Content-Security-Policy"
status: Proposed
date: 2026-10-05
proposed_date: 2026-10-05
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [security, nextjs, headers, csp]
related_briefs: []
related_research: []
---

# ADR-0031 — Send baseline security headers now and defer a Content-Security-Policy

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

`apps/web/next.config.ts` sets no security headers and no Content-Security-Policy; the only policies are on a sandboxed document preview frame and on one live-session route. The audit finding is NX-SEC-01. The shell holds live interview content. A nonce-based CSP needs dynamic rendering and allowances for the on-device OCR worker, WebAssembly and Mermaid rendering, and it would put the locked live panel at risk if it were wrong.

## Decision

1. **Baseline headers now.** Every response from the web shell carries a fixed set: framing allowed only by the same origin, no content sniffing, a restrictive referrer policy, and a permissions policy that still allows the same-origin features the product uses, such as the microphone for web listening. The framework's version header is not sent.
2. **The headers are static.** They need no per-request state and do not change rendering.
3. **A Content-Security-Policy is deferred.** It is not enforced until it has been proven against the OCR worker, WebAssembly, Mermaid, the document preview frame and the locked live panel, in a form that does not change the live panel's behaviour.
4. **Revisit triggers.** A hosted deployment target is chosen, or a CSP can be proven in a non-enforcing mode against those cases.

## Alternatives Considered

### Option A — A nonce-based CSP now
- **Pros:** the strongest script-injection defence.
- **Cons:** forces dynamic rendering of every page, needs allowances for the OCR worker, WebAssembly and Mermaid, and can break the locked live panel.
- **Why not:** the risk to a locked surface outweighs a defence that has no known exploit path today.

### Option B — No headers at all
- **Pros:** nothing to maintain.
- **Cons:** clickjacking and sniffing protections absent for a page holding private content.
- **Why not:** the baseline set is small and safe.

## Consequences

**Positive:**
- Cheap protection against framing, sniffing and referrer leakage.

**Negative:**
- No script-injection defence in depth beyond the existing sandboxed preview CSP; markup is protected by the sanitising and sandboxing already in place.

**Follow-on work:**
- Implement the headers (tracker row NX-SEC-01/02); a CSP proposal later.

## References

- `apps/web/next.config.ts`.
- `bionic/inbox/audit/technology-consistency.md` (NX-SEC-01, NX-SEC-02).
- `bionic/inbox/redesign/resolution-tracker.md`
