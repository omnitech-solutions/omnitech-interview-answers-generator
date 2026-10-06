import { NativeSignInRoute } from "@omnitech/product-interview/frontend";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };
// Never cached: whether this Studio offers a sign-in is read when the page loads.
export const dynamic = "force-dynamic";

// The public sign-in screen of the Mac app's compact window. The tenant routes
// refuse a signed-out visitor, so the shell loads this page instead. It reads no
// session, tenant or member, and writes nothing: a page of the Mac app's own UI
// (the product frontend draws it) that asks Studio only what can sign in.
export default function NativeSignInPage() {
  return <NativeSignInRoute />;
}
