// The overlay route: /t/<tenant>/p/<product>/live/overlay. Only the native
// shell loads it: `?panel=single` is its one compact window, `?panel=settings`
// the small Settings window beside it, and a load that names neither is the
// compact window. (An ordinary browser tab on this route is sent to the Studio
// live page by overlay-guard.ts before this page is drawn.) The page is its
// own: its own session store and polling (same-origin cookies), so it does not
// depend on the Studio live page being mounted or visible.
import type { ProductMember } from "@omnitech/platform-contracts";
import { PanelsRoot } from "./panels/panels-root";

export function OverlayPage({ member }: { member?: ProductMember } = {}) {
  const named = new URLSearchParams(window.location.search).get("panel");
  const panel = named === "settings" ? "settings" : "single";
  return <PanelsRoot panel={panel} {...(member ? { member } : {})} />;
}
