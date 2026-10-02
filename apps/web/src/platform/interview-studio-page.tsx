"use client";

import type { ProductPageProps } from "@omnitech/platform-contracts";
import dynamic from "next/dynamic";

// Interview Studio renders only in the browser. Loading it without
// server rendering keeps its editor, highlighter and assistant out of the
// server build, so the page compiles once rather than twice.
export const InterviewStudioPage = dynamic<ProductPageProps>(
  () =>
    import("@omnitech/product-interview/frontend").then(
      ({ StudioPage }) => StudioPage,
    ),
  { ssr: false },
);
