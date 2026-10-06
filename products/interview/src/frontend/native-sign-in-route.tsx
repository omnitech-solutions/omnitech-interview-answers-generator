"use client";

// The public page the native shell loads while no Studio session exists: the
// compact window's own sign-in screen. The tenant routes refuse a signed-out
// visitor (they redirect to /sign-in, which the shell never shows in its
// privileged web view), so this page is what the window can show instead.
//
// [SAFETY] Public and read-only: it reads no tenant and no member, makes no
// write, and carries no content. It draws the sign-in screen only; signing in is
// the shell's browser round trip, or the local profile's own Auth.js sign-in,
// both of which Studio's server decides.
import { lazy, Suspense, useEffect, useState } from "react";
import {
  accountHost,
  navigation,
} from "./studio/live/overlay/panels/use-account";

// The panels module is imported only in the browser, after mount, like the studio.
const SignedOutPanel = lazy(() =>
  import("./studio/live/overlay/panels/panels-root").then(({ PanelsRoot }) => ({
    default: () => <PanelsRoot panel="single" signedOut />,
  })),
);

// [DOMAIN] Only the Mac app can sign in through this screen (its bridge opens the
// browser round trip). Anywhere else - an ordinary browser - the page is the web
// sign-in, so a person who lands here gets a real login page, not a bare notice.
export function NativeSignInRoute() {
  const [mounted, setMounted] = useState(false);
  const [inApp, setInApp] = useState(false);
  useEffect(() => {
    const host = accountHost();
    if (host) setInApp(true);
    else navigation.assign("/sign-in");
    setMounted(true);
  }, []);
  return mounted && inApp ? (
    <Suspense fallback={null}>
      <SignedOutPanel />
    </Suspense>
  ) : null;
}
