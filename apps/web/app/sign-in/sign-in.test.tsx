import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ signIn: vi.fn() }));
const headerState = vi.hoisted(() => ({ host: "localhost:3000" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: headerState.host }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { SignInView } = await import("./sign-in-view");
const { default: SignInPage } = await import("./page");

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
  headerState.host = "localhost:3000";
});

const view = (props: Partial<Parameters<typeof SignInView>[0]> = {}) =>
  render(
    <SignInView
      next={null}
      nextLabel={null}
      expired={false}
      providers={{ google: true, linkedin: true }}
      localAvailable={false}
      {...props}
    />,
  );

describe("the sign-in view", () => {
  it("shows the title, subtitle, both providers and the footnote", () => {
    view();
    expect(
      screen.getByRole("heading", { name: "Sign in to Interview Studio" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Prepare, rehearse and get live help in developer interviews.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toHaveProperty("disabled", false);
    expect(
      screen.getByRole("button", { name: /Continue with LinkedIn/ }),
    ).toHaveProperty("disabled", false);
    expect(
      screen.getByText(
        "We only receive your name, email and photo. Studio never sees your password.",
      ),
    ).toBeTruthy();
  });

  it("hides the local user, its divider and note when it is not offered", () => {
    view({ localAvailable: false });
    expect(
      screen.queryByRole("button", { name: /Continue as local user/ }),
    ).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByText(/running on this computer/)).toBeNull();
  });

  it("offers the local user with the design's note when it is offered", () => {
    view({ localAvailable: true });
    expect(
      screen.getByRole("button", { name: /Continue as local user/ }),
    ).toBeTruthy();
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(
      screen.getByText(
        "Shown because Studio is running on this computer. No account or password; data stays here.",
      ),
    ).toBeTruthy();
  });

  it("names the place a deep link returns to, and carries the target", () => {
    const { container } = view({
      next: "/t/local/p/interview/live",
      nextLabel: "Live session",
    });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toBe(
      "You’ll go back to Live session after signing in",
    );
    const hidden = [
      ...container.querySelectorAll<HTMLInputElement>('input[name="next"]'),
    ];
    expect(hidden.length).toBeGreaterThan(0);
    expect(
      hidden.every((input) => input.value === "/t/local/p/interview/live"),
    ).toBe(true);
  });

  it("has no deep-link banner without a target", () => {
    view();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the expired banner and a welcome-back title instead of the deep link", () => {
    view({
      expired: true,
      next: "/t/local/p/interview/live",
      nextLabel: "Live session",
    });
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    const banner = screen.getByRole("status");
    expect(within(banner).getByText(/Your sign-in expired/)).toBeTruthy();
    expect(screen.queryByText(/You’ll go back to/)).toBeNull();
  });

  it("disables a provider that is not configured and says why", () => {
    view({ providers: { google: false, linkedin: true } });
    const google = screen.getByRole("button", { name: /Continue with Google/ });
    expect(google).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Google sign-in is not set up on this Studio."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Continue with LinkedIn/ }),
    ).toHaveProperty("disabled", false);
  });

  it("marks the last provider used, from what this browser stored", async () => {
    window.localStorage.setItem("studio.last-provider", "google");
    view();
    const google = screen.getByRole("button", { name: /Continue with Google/ });
    expect(await within(google).findByText("Last used")).toBeTruthy();
    const linkedin = screen.getByRole("button", {
      name: /Continue with LinkedIn/,
    });
    expect(within(linkedin).queryByText("Last used")).toBeNull();
  });

  it("shows no last-used chip when nothing was stored", () => {
    view();
    expect(screen.queryByText("Last used")).toBeNull();
  });
});

describe("the sign-in page", () => {
  const params = (value: Record<string, string | string[]>) =>
    Promise.resolve(value);

  it("offers the local user on a loopback host with FAKE_AUTH_ENABLED", async () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    render(await SignInPage({ searchParams: params({}) }));
    expect(
      screen.getByRole("button", { name: /Continue as local user/ }),
    ).toBeTruthy();
  });

  it("hides the local user on any other host", async () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    headerState.host = "studio.example.com";
    render(await SignInPage({ searchParams: params({}) }));
    expect(
      screen.queryByRole("button", { name: /Continue as local user/ }),
    ).toBeNull();
  });

  it("hides the local user without FAKE_AUTH_ENABLED", async () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "");
    render(await SignInPage({ searchParams: params({}) }));
    expect(
      screen.queryByRole("button", { name: /Continue as local user/ }),
    ).toBeNull();
  });

  it("turns a safe next into the deep-link banner and ignores an unsafe one", async () => {
    const { unmount } = render(
      await SignInPage({
        searchParams: params({ next: "/t/local/p/interview/live" }),
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("Live session");
    unmount();
    render(
      await SignInPage({
        searchParams: params({ next: "https://evil.example/t/local" }),
      }),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the expired state for ?reason=expired", async () => {
    render(await SignInPage({ searchParams: params({ reason: "expired" }) }));
    expect(screen.getByText(/Your sign-in expired/)).toBeTruthy();
  });

  it("enables only the providers the environment configures", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "secret");
    vi.stubEnv("AUTH_LINKEDIN_ID", "");
    render(await SignInPage({ searchParams: params({}) }));
    expect(
      screen.getByRole("button", { name: /Continue with Google/ }),
    ).toHaveProperty("disabled", false);
    expect(
      screen.getByRole("button", { name: /Continue with LinkedIn/ }),
    ).toHaveProperty("disabled", true);
  });
});
