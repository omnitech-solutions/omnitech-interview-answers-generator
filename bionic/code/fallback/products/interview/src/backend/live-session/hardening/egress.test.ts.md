# products/interview/src/backend/live-session/hardening/egress.test.ts

_Source: `products/interview/src/backend/live-session/hardening/egress.test.ts` (header-comment fallback)_

Hardening case 6 (PB-0002 slice 3): remote egress is blocked in device-only
across the WHOLE question -> draft path, two ways at once:
- spy provider ports behind the REAL engine (a remote adapter that is
ever called fails the assertion), and
- a network-level guard (global fetch, http(s), TCP connect) that records
and refuses any destination other than loopback and the test database.
The path is the real one: fixture companion -> real routes -> real
processor -> real engine -> stored draft -> the owner's own reads.
