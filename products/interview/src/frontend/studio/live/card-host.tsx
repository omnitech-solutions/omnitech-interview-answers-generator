// Where the in-tab card lives: in the Studio shell's main area, so it persists
// across Studio pages while a session exists and the person left it open. The
// card itself renders nothing without a session. Closing it (or leaving the
// session) is what ends it, never navigating.
import { cardInTab, usePresentation } from "./focus-presentation";
import { OverlayCard } from "./overlay/overlay-card";

export function LiveCardHost() {
  const presented = usePresentation();
  return cardInTab(presented) ? <OverlayCard variant="tab" /> : null;
}
