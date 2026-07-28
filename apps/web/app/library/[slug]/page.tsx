import React from "react";

import { LibraryClientPage } from "../client-page";

export default async function LibraryArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <LibraryClientPage initialSlug={slug} />;
}
