"use client";

import dynamic from "next/dynamic";
import React from "react";

const Playground = dynamic(
  () =>
    import("@omnitech/product-interview/frontend").then(
      (module) => module.Workspace,
    ),
  {
    loading: () => <main className="loading-page">Loading workspace…</main>,
    ssr: false,
  },
);

export function ClientPage() {
  return <Playground />;
}
