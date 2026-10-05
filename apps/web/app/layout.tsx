// Stylesheets are intentionally imported for their application-wide side effect.
// oxlint-disable import/no-unassigned-import
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@oc-tech/omni-ui-components/styles.css";
import "@omnitech-assistant/react/styles.css";
import "./styles.css";
import "@omnitech/product-interview/studio.css";
import "@omnitech/product-presentation/presentation.css";

import type { Metadata } from "next";
import { type ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Omnitech Studio",
    template: "%s · Omnitech Studio",
  },
  description: "A configurable catalog of AI-assisted creative products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* Browser extensions add attributes to <body> before React loads. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
