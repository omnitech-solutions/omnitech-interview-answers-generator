# products/interview/src/frontend/studio/live/overlay/panels/start-panel.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/start-panel.tsx` (header-comment fallback)_

What the native window shows before a session runs, inside the SAME chrome as
the live window: the real toolbar (every session control disabled and naming
what is missing), a titled card, and the real footer. Four stages:
out      "Sign in to start a session": Google, LinkedIn, and this Mac
waiting  "Finish signing in in your browser" (the shell opened the browser)
local    "Use Studio on this Mac only", what that means, Back / Continue
idle     "No live session": what to start, the Mac's permissions, Start
The page decides nothing about identity: the shell runs the browser round trip
and the web view's own sign-in, and Studio's server says who the member is.

[SAFETY] A button that cannot work is not drawn (no provider Studio offers, no
bridge); starting is never silent: a session starts only from the Start button,
after the Mac's permissions and, for an interview, "everyone has agreed".
