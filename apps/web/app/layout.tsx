// Stylesheets are intentionally imported for their application-wide side effect.
// oxlint-disable import/no-unassigned-import
import "@omnitech/omni-ui-core/styles.css";
import "./styles.css";

import type { Metadata } from "next";
import React, { type ReactNode } from "react";

export const metadata: Metadata = {
  title: "Interview Answers Playground",
  description: "A local-first, AI-assisted interview coding playground.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
