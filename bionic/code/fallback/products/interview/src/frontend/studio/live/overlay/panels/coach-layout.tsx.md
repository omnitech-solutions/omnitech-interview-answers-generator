# products/interview/src/frontend/studio/live/overlay/panels/coach-layout.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/coach-layout.tsx` (header-comment fallback)_

The coach layouts: the call at the top of the window and the coach's notes
directly beneath it, so the person reads without looking away from the
interviewer. Three of them share this file (chat-view-pref.ts names them):

coach         questions | call + coach | answer, transcript and code (tabs)
conversation  questions | call + notes | transcript
prompter      call + one question's notes

[DOMAIN] Colour carries role and nothing else: green is what the interviewer
asked and the question on the table, blue is the words to land, amber is a
warning, white is the text to read, grey is everything secondary. A note is
never swapped out while it is being read: a new one is added beneath, and
the pane follows it only when the reader is already at the bottom.

What is drawn comes from the UI library; the few inline styles left size
the layout's own boxes (the columns, the call's room).
