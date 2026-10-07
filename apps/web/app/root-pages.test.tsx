import type React from "react";
import { describe, expect, it, vi } from "vitest";

// NextAuth is the identity boundary: signing in hands off to a provider.
const nextAuth = vi.hoisted(() => ({
  signIn: vi.fn(async () => undefined),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));
vi.mock("@/auth", () => nextAuth);

describe("the application frame", () => {
  it("names the studio and wraps every page in an English document", async () => {
    const { default: RootLayout, metadata } = await import("./layout");
    const page = RootLayout({ children: <p>Page</p> }) as React.ReactElement<{
      lang: string;
      children: React.ReactElement<{ children: React.ReactNode }>;
    }>;
    expect(page.props.lang).toBe("en");
    expect(page.props.children.props.children).toEqual(<p>Page</p>);
    expect(metadata.title).toEqual({
      default: "Omnitech Studio",
      template: "%s · Omnitech Studio",
    });
  });

  it("serves NextAuth's sign-in endpoints", async () => {
    const route = await import("./api/auth/[...nextauth]/route");
    expect(route.GET).toBe(nextAuth.handlers.GET);
    expect(route.POST).toBe(nextAuth.handlers.POST);
  });
});
