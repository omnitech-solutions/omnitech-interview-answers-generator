import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioPage } from "./studio-page";
import { studioFetch, TENANT_HEADER } from "./studio-fetch";

const created = vi.hoisted(() => ({ options: undefined as unknown }));
vi.mock("@omnitech-assistant/sdk", () => ({
  createAssistantClient: (options: unknown) => {
    created.options = options;
    return { options };
  },
}));
vi.mock("./studio", () => ({
  Studio: ({ assistant }: { assistant: { profileId: string } }) => (
    <div>Studio on {assistant.profileId}</div>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("StudioPage", () => {
  it("renders the studio with an assistant that names the page's tenant", () => {
    render(<StudioPage />);
    expect(screen.getByText("Studio on interview-assistant")).toBeVisible();
    expect(created.options).toMatchObject({
      baseUrl: "/api/assistant/v1",
      fetch: studioFetch,
    });
  });
});

describe("studioFetch", () => {
  it("sends the tenant of the page it runs on, and nothing outside a tenant", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState({}, "", "/t/acme%20co/p/interview/work");
    await studioFetch("/api/interview/plan", {
      headers: { "content-type": "application/json" },
    });
    const headers = new Headers(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers,
    );
    expect(headers.get(TENANT_HEADER)).toBe("acme co");
    expect(headers.get("content-type")).toBe("application/json");

    window.history.replaceState({}, "", "/library");
    await studioFetch("/api/v1/library/search");
    expect(fetch.mock.calls[1]).toEqual(["/api/v1/library/search", {}]);
  });
});
