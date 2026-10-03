import type { PlatformContext } from "@omnitech/platform-contracts";
import { act, render, screen } from "@testing-library/react";
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Next.js supplies the URL; the shell reads only the pathname.
const location = vi.hoisted(() => ({ pathname: "/t/acme" }));
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname }));

const { PlatformShell } = await import("./platform-shell");
const { productFrames } = await import("./registry");

const context = (
  preferences: PlatformContext["preferences"] = {
    theme: "light",
    locale: "en",
  },
): PlatformContext => ({
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "member@acme.test",
    displayName: "Member",
    avatarUrl: null,
  },
  tenant: {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "acme",
    name: "Acme",
  },
  membership: {
    tenantId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000001",
    role: "member",
  },
  preferences,
  permissions: [],
  products: [],
});

type Sent = { url: string; init: RequestInit | undefined };
let sent: Sent[];
beforeEach(() => {
  sent = [];
  window.localStorage.clear();
  location.pathname = "/t/acme";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), init });
      if (String(input).startsWith("/api/platform/v1/ai-targets"))
        return Response.json([
          { id: "images", kind: "image", family: "direct-model" },
          { id: "claude-code", kind: "language", family: "agent" },
          { id: "fast", kind: "language", family: "direct-model" },
        ]);
      return Response.json({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));
function renderShell(value = context(), strict = false) {
  const shell = (
    <PlatformShell context={value} frames={productFrames()}>
      <p>Product page</p>
    </PlatformShell>
  );
  return render(strict ? <StrictMode>{shell}</StrictMode> : shell);
}
const frameOf = () =>
  screen.getByText("Product page").closest(".platform-frame")?.className;

describe("the frame around a page", () => {
  it("frames a product page as its registration asks", () => {
    location.pathname = "/t/acme/p/interview/briefings";
    renderShell();
    expect(frameOf()).toContain("platform-frame-fill-viewport");
  });

  it("frames a product named by its full id the same way", () => {
    location.pathname = "/t/acme/p/omnitech.interview";
    renderShell();
    expect(frameOf()).toContain("platform-frame-fill-viewport");
  });

  it("uses the standard frame outside products and for unknown products", () => {
    renderShell();
    expect(frameOf()).toContain("platform-frame-standard");
    location.pathname = "/t/acme/p/unknown";
    renderShell();
    expect(
      screen.getAllByText("Product page")[1]?.closest(".platform-frame"),
    ).toHaveClass("platform-frame-standard");
  });
});

describe("the member's preferences", () => {
  it("applies the chosen theme and locale to the document", () => {
    renderShell(context({ theme: "dark", locale: "fr" }));
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("follows the operating system when the theme is 'system'", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    renderShell(context({ theme: "system", locale: "en" }));
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });
});

describe("the member's AI profile", () => {
  it("hands products a saved choice without asking the server", async () => {
    renderShell(context({ theme: "light", locale: "en", aiProfileId: "fast" }));
    await settle();
    expect(window.localStorage.getItem("platform.aiProfileId")).toBe("fast");
    expect(sent).toEqual([]);
  });

  it("defaults to the first direct language model, with one live request", async () => {
    renderShell(context(), true);
    await settle();
    expect(window.localStorage.getItem("platform.aiProfileId")).toBe("fast");
    const live = sent.filter(({ init }) => !init?.signal?.aborted);
    expect(live.map(({ url }) => url)).toEqual([
      "/api/platform/v1/ai-targets?tenant=acme",
    ]);
  });

  it("stores nothing when the targets cannot be listed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    renderShell();
    await settle();
    expect(window.localStorage.getItem("platform.aiProfileId")).toBeNull();
  });

  it("saves a product's new choice as the member's preference", async () => {
    renderShell(context({ theme: "dark", locale: "en", aiProfileId: "fast" }));
    act(() => {
      window.dispatchEvent(
        new CustomEvent("platform-ai-profile-change", {
          detail: { profileId: "claude-code" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("platform-ai-profile-change", { detail: {} }),
      );
    });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("/api/platform/v1/preferences?tenant=acme");
    expect(sent[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({
      theme: "dark",
      locale: "en",
      aiProfileId: "claude-code",
    });
  });
});
