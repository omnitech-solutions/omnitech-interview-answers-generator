"use client";

import dynamic from "next/dynamic";
import React from "react";

const Playground = dynamic(
  () => import("@/src/playground").then((module) => module.Playground),
  {
    loading: () => <main className="loading-page">Loading playground…</main>,
    ssr: false,
  },
);

export function ClientPage() {
  return <Playground />;
}
