"use client";

import dynamic from "next/dynamic";
import React from "react";

const Library = dynamic(
  () => import("@/src/library").then((module) => module.Library),
  {
    loading: () => <main className="loading-page">Loading Library…</main>,
    ssr: false,
  },
);

export function LibraryClientPage({
  initialSlug,
}: {
  initialSlug?: string | undefined;
}) {
  return <Library initialSlug={initialSlug} />;
}
