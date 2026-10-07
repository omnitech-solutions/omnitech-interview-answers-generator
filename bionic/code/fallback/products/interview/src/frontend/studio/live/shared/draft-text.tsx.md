# products/interview/src/frontend/studio/live/shared/draft-text.tsx

_Source: `products/interview/src/frontend/studio/live/shared/draft-text.tsx` (header-comment fallback)_

A drafted answer is Markdown point form the model wrote: bullets and
**bold** key terms. This renders exactly that and nothing else: no HTML, no
links, no images, no headings, no code, so model text can never become
markup or a request (rule:captured-input-untrusted). Everything it does not
recognise stays literal text.
