import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(async () => undefined),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  host: "localhost:3000",
}));
vi.mock("@/auth", () => ({ signIn: mocks.signIn }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: mocks.host }),
}));

const { signInWith } = await import("./actions");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.host = "localhost:3000";
});

describe("signInWith", () => {
  it("starts the provider and returns to a safe target, marking the sign-in", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "secret");
    await signInWith(
      form({ provider: "google", next: "/t/local/p/interview/live" }),
    );
    expect(mocks.signIn).toHaveBeenCalledWith("google", {
      redirectTo: "/t/local/p/interview/live?signed-in=google",
    });
  });

  it("lands on the product home when the target is missing or unsafe", async () => {
    vi.stubEnv("AUTH_LINKEDIN_ID", "id");
    vi.stubEnv("AUTH_LINKEDIN_SECRET", "secret");
    await signInWith(form({ provider: "linkedin", next: "//evil.example" }));
    expect(mocks.signIn).toHaveBeenCalledWith("linkedin", {
      redirectTo: "/t/local/p/interview?signed-in=linkedin",
    });
  });

  it("signs in the local user only where it is offered", async () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    await signInWith(form({ provider: "local" }));
    expect(mocks.signIn).toHaveBeenCalledWith("local", {
      redirectTo: "/t/local/p/interview?signed-in=local",
    });
  });

  it("refuses the local user on a non-loopback host", async () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    mocks.host = "studio.example.com";
    await expect(signInWith(form({ provider: "local" }))).rejects.toThrow(
      "redirect:/sign-in",
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("refuses a provider that is not configured, and unknown names", async () => {
    await expect(signInWith(form({ provider: "google" }))).rejects.toThrow(
      "redirect:/sign-in",
    );
    await expect(signInWith(form({ provider: "github" }))).rejects.toThrow(
      "redirect:/sign-in",
    );
    await expect(signInWith(form({}))).rejects.toThrow("redirect:/sign-in");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
