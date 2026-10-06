import type { Metadata } from "next";

import { SignedOutView } from "./signed-out-view";

export const metadata: Metadata = { title: "Signed out" };

export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { as } = await searchParams;
  return <SignedOutView local={as === "local"} />;
}
