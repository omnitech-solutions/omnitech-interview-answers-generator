# products/interview/src/backend/live-session/screenshot-send.ts

_Source: `products/interview/src/backend/live-session/screenshot-send.ts` (header-comment fallback)_

What of a task revision's screenshots a model call carries (decision D35):
applies the owner's stored per-session setting, through the image gate, to
the screenshots a revision rests on. The server alone decides: the page's
claim of a setting is never read, and the OCR metrics the page sent are only
evidence the gate weighs (they were validated and bounded on the way in).
Everything returned is ids, names, ordinals and closed words, plus the
machine-read texts the prompt already carries; nothing here is logged.
