import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// NextAuth is the identity boundary: signing in hands off to a provider.
const nextAuth = vi.hoisted(() => ({
  signIn: vi.fn(async () => undefined),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));
vi.mock("@/auth", () => nextAuth);
afterEach(() => vi.unstubAllEnvs());

describe("the sign-in page", () => {
  it("signs in with Google or LinkedIn and returns to the local tenant", async () => {
    const { default: SignInPage } = await import("./sign-in/page");
    render(<SignInPage />);
    expect(
      screen.queryByRole("button", { name: "Continue as local user" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with LinkedIn" }),
    );
    await vi.waitFor(() =>
      expect(nextAuth.signIn).toHaveBeenCalledWith("linkedin", {
        redirectTo: "/t/local",
      }),
    );
    expect(nextAuth.signIn).toHaveBeenCalledWith("google", {
      redirectTo: "/t/local",
    });
  });

  it("offers the local user in local development", async () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    const { default: SignInPage } = await import("./sign-in/page");
    render(<SignInPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue as local user" }),
    );
    await vi.waitFor(() =>
      expect(nextAuth.signIn).toHaveBeenCalledWith("local", {
        redirectTo: "/t/local",
      }),
    );
  });
});

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
