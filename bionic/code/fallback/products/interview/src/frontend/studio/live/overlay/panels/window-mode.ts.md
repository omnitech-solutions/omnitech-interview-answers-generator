# products/interview/src/frontend/studio/live/overlay/panels/window-mode.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/window-mode.ts` (header-comment fallback)_

The one window's size mode (WINDOW_MODES): Normal, Mini player or Full screen.
The page owns it and it always starts Normal; the shell is only told the
size (setWindowSize) or full screen (setFullScreen) and reports nothing back.
Leaving full screen always asks the shell to restore the frame first, so the
next size change starts from the window the person had.
