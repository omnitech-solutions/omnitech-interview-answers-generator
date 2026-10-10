# products/interview/src/backend/documents/render-blank.ts

_Source: `products/interview/src/backend/documents/render-blank.ts` (header-comment fallback)_

[DOMAIN] What a line of a template becomes when some of its values are
empty. A finished document must not show the scaffolding around a value
that is not there: no "|  |  |  Calgary, AB", no "~  (- )", no bullet or
"Label:" with nothing after it. The same rules serve DOCX paragraphs and
Markdown lines, which is why they work on a line's text and the places its
placeholders sit in it, not on either format.
