# products/interview/src/frontend/studio/live/overlay/use-dismiss.ts

_Source: `products/interview/src/frontend/studio/live/overlay/use-dismiss.ts` (header-comment fallback)_

Closing a popover: a press outside it (listened for on its own document, so it
works in the PiP's iframe too), or Escape inside it (not while an IME
composition is active). The Escape handler marks the event handled so the card
does not also act on it (it restores a maximized card on Escape).
