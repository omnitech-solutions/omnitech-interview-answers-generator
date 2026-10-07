# products/interview/src/frontend/studio/live/overlay/panels/chat-panel.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/chat-panel.tsx` (header-comment fallback)_

The Transcript & chat panel (the library Panel: a 40 px header, a body that
scrolls and follows the newest line, and the composer docked under it). The
body holds speech turns, the person's own messages and one-line capture event
chips, and nothing else: recording and other system status is never written
into it. Each bubble can be copied, a merged phrase says `edited`, and an
answer's bubble can be chosen to bring its task into the answer and code
panes. It takes the one panel session and renders it; none of it fetches or
decides anything itself.
