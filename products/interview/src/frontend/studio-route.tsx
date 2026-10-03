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

// Every interview route renders the whole studio, which routes within
// itself from the URL. It renders in the browser only.
export function StudioRoute(_props: ProductPageProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? (
    <Suspense fallback={null}>
      <StudioPage />
    </Suspense>
  ) : null;
}
