"use client";

import React from "react";

import { Library } from "@/src/library";

export function LibraryClientPage({
  initialSlug,
}: {
  initialSlug?: string | undefined;
}) {
  return <Library initialSlug={initialSlug} />;
}
