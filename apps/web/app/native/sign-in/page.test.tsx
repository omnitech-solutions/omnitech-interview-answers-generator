import { describe, expect, it, vi } from "vitest";

// The product draws the screen; the page only mounts it.
vi.mock("@omnitech/product-interview/frontend", () => ({
  NativeSignInRoute: () => null,
}));

import { NativeSignInRoute } from "@omnitech/product-interview/frontend";
import NativeSignInPage, { dynamic, metadata } from "./page";

describe("the Mac app's public sign-in page", () => {
  it("mounts the product's sign-in screen and nothing else, uncached", () => {
    const page = NativeSignInPage();
    expect(page.type).toBe(NativeSignInRoute);
    expect(page.props).toEqual({});
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.title).toBe("Sign in");
  });

  it("reads no session, tenant or member: it imports neither the auth boundary nor the platform context", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
    expect(source).not.toMatch(
      /from "@\/auth"|platform\/context|next\/headers/,
    );
  });
});
