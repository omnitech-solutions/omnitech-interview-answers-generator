"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import { lazy, Suspense, useEffect, useState } from "react";

// The studio module (editor, highlighter, assistant) is imported only in the
// browser, after mount, so the server never evaluates it.
const StudioPage = lazy(() =>
  import("./studio/studio-page.js").then(({ StudioPage }) => ({
    default: StudioPage,
  })),
);

// The chromeless overlay (/live/overlay): only the live session card, a page of
// its own with its own session store. It never loads the studio module.
const OverlayPage = lazy(() =>
  import("./studio/live/overlay/overlay-page.js").then(({ OverlayPage }) => ({
    default: OverlayPage,
  })),
);
const isOverlay = (pathname: string) => /\/live\/overlay\/?$/.test(pathname);

// Every interview route renders the whole studio, which routes within
// itself from the URL. It renders in the browser only.
export function StudioRoute({ products }: ProductPageProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? (
    <Suspense fallback={null}>
      {isOverlay(window.location.pathname) ? (
        <OverlayPage />
      ) : (
        <StudioPage products={products} />
      )}
    </Suspense>
  ) : null;
}
