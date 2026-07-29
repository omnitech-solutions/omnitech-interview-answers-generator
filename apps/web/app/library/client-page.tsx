"use client";

import React from "react";

import { Library } from "@omnitech/product-interview/frontend";

export function LibraryClientPage({
  initialSlug,
}: {
  initialSlug?: string | undefined;
}) {
  return <Library initialSlug={initialSlug} />;
}
