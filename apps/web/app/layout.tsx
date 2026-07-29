// Stylesheets are intentionally imported for their application-wide side effect.
// oxlint-disable import/no-unassigned-import
import "@oc-tech/omni-ui-components/styles.css";
import "./styles.css";

import type { Metadata } from "next";
import React, { type ReactNode } from "react";

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
      <body>{children}</body>
    </html>
  );
}
