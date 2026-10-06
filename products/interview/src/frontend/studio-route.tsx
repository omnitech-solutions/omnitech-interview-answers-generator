"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  isStandaloneDisplay,
  overlayRedirect,
} from "./studio/live/overlay/overlay-guard";

// The studio module (editor, highlighter, assistant) is imported only in the
// browser, after mount, so the server never evaluates it.
const StudioPage = lazy(() =>
  import("./studio/studio-page").then(({ StudioPage }) => ({
    default: StudioPage,
  })),
);

// The chromeless overlay (/live/overlay): only the live session card, a page of
// its own with its own session store. It never loads the studio module.
const OverlayPage = lazy(() =>
  import("./studio/live/overlay/overlay-page").then(({ OverlayPage }) => ({
    default: OverlayPage,
  })),
);
const isOverlay = (pathname: string) => /\/live\/overlay\/?$/.test(pathname);

// An ordinary browser tab on the overlay route goes to the full /live page.
const redirectTo = (): string | null =>
  isOverlay(window.location.pathname)
    ? overlayRedirect({
        search: window.location.search,
        pathname: window.location.pathname,
        standalone: isStandaloneDisplay(),
      })
    : null;

// Every interview route renders the whole studio, which routes within
// itself from the URL. It renders in the browser only.
export function StudioRoute({ products, member }: ProductPageProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const away = mounted ? redirectTo() : null;
  useEffect(() => {
    if (away) window.location.replace(away);
  }, [away]);
  if (away) return null;
  return mounted ? (
    <Suspense fallback={null}>
      {isOverlay(window.location.pathname) ? (
        <OverlayPage {...(member ? { member } : {})} />
      ) : (
        <StudioPage products={products} {...(member ? { member } : {})} />
      )}
    </Suspense>
  ) : null;
}
