# products/interview/src/backend/context-pack/application.ts

_Source: `products/interview/src/backend/context-pack/application.ts` (header-comment fallback)_

An application's kept context pack, read for a briefing or a document.

PROBLEM: a briefing and a document are written in the web server, each for
an application the member owns, and each must read the pack a model
prepared for that application when there is one, and behave exactly as
before when there is none. STRATEGY: one port. It settles ownership in the
member's own scope (the application's candidate is the member, or it
answers nothing), loads the kept pack, prepares today's material beside it
in code (pack.ts: no model), and hands the reader its projection
(readers.ts). Any failure on the way (no store, nothing kept, a store that
does not answer, material the recipe refuses) is "no pack": the reader
falls back, and never fails for want of one.
