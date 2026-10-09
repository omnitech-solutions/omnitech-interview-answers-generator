# products/interview/src/frontend/studio/live/overlay/panels/chat-view-pref.test.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/chat-view-pref.test.ts` (header-comment fallback)_

How the live window is laid out (the View menu): the choice, where it is kept, and who is
told. The suite's setup replaces useChatView with a test-controlled value, so
this file reads the real module, fresh for each test (it remembers the
choice in a module variable).
