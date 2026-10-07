# products/interview/src/frontend/studio/live/overlay/use-hands-free.test.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/use-hands-free.test.tsx` (header-comment fallback)_

The hands-free controller (use-hands-free.ts) through the real store and
client against a scripted service, with a fake display stream, canvas pixels
and SpeechRecognition (ADR-0022): a heard question is sent as speech with no
button; a changed screen is analysed once, within the limits; nothing stays
stuck. Driven through a bare probe, not a product surface.
