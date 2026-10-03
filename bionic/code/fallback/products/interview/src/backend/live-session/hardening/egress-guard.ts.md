# products/interview/src/backend/live-session/hardening/egress-guard.ts

_Source: `products/interview/src/backend/live-session/hardening/egress-guard.ts` (header-comment fallback)_

A network-level egress guard for tests: while installed, any attempt to
leave the machine - global fetch, http(s).request/get, or a TCP connect to a
host that is not on the allow list - is recorded and refused with a thrown
error. It is the safety net under spy adapters: a spy proves no adapter was
called; this proves nothing ELSE reached the network on the path either.
Tests, not production code, import this.
