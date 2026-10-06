import type { Metadata } from "next";
import { headers } from "next/headers";

import { localSignInAvailable } from "@/src/platform/fake-auth";
import { configuredLoginProviders } from "@/src/platform/native-handoff";
import {
  returnTargetLabel,
  safeReturnTarget,
} from "@/src/platform/return-target";
import { SignInView } from "./sign-in-view";

export const metadata: Metadata = { title: "Sign in" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? undefined : value;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeReturnTarget(first(query["next"]));
  const configured = configuredLoginProviders();
  return (
    <SignInView
      next={next}
      nextLabel={next ? returnTargetLabel(next) : null}
      expired={first(query["reason"]) === "expired"}
      providers={{
        google: configured.includes("google"),
        linkedin: configured.includes("linkedin"),
      }}
      localAvailable={localSignInAvailable(await headers())}
    />
  );
}
