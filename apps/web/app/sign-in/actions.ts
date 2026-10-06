"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { localSignInAvailable } from "@/src/platform/fake-auth";
import { configuredLoginProviders } from "@/src/platform/native-handoff";
import {
  safeReturnTarget,
  signInPath,
  withSignedInMarker,
} from "@/src/platform/return-target";

// One form action for every provider button. The provider and the return
// target arrive as form fields, so both are validated here, on the server:
// only a configured provider (or the local one, where it is offered) and a
// same-origin /t/ path are accepted.
export async function signInWith(formData: FormData): Promise<void> {
  const provider = formData.get("provider");
  const next = safeReturnTarget(formData.get("next"));
  const allowed: readonly string[] = [
    ...configuredLoginProviders(),
    ...(localSignInAvailable(await headers()) ? ["local"] : []),
  ];
  // [GUARD] An unknown or unavailable provider goes back to the page, which
  // shows what is available, instead of starting a sign-in that cannot work.
  if (
    (provider !== "google" &&
      provider !== "linkedin" &&
      provider !== "local") ||
    !allowed.includes(provider)
  ) {
    redirect(signInPath(next));
  }
  await signIn(provider, { redirectTo: withSignedInMarker(next, provider) });
}
