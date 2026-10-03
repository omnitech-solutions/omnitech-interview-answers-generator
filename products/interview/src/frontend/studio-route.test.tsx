import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frontendPlugin, manifest } from "../manifest";

// The studio's own server: empty lists, and an assistant that offers nothing.
function installServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split("?")[0];
      if (path === "/api/assistant/v1/capabilities")
        return Response.json({ features: [] });
      if (path === "/api/interview/workspaces/interview/artifacts")
        return Response.json([]);
      if (path === "/api/interview/briefing/artifacts")
        return Response.json({ artifacts: [] });
      if (path === "/api/interview/briefs")
        return Response.json({ briefs: [] });
      return Response.json(
        { code: "not-found", message: "Not here." },
        { status: 404 },
      );
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("Interview Studio as a registered product", () => {
  it("loads the same client-only studio for every route", async () => {
    const pages = await Promise.all(
      manifest.routes.map((route) => frontendPlugin.routes[route.id]!()),
    );
    expect(new Set(pages.map((page) => page.default)).size).toBe(1);
    expect(pages[0]!.default.name).toBe("StudioRoute");
  });

  it("renders the studio in the browser at the route's view", async () => {
    installServer();
    window.history.replaceState({}, "", "/t/local/p/interview/rehearsal");
    const { default: StudioRoute } =
      await frontendPlugin.routes["interview.rehearsal"]!();
    render(
      <StudioRoute
        pathSegments={["rehearsal"]}
        routeId="interview.rehearsal"
        tenantSlug="local"
      />,
    );
    expect(
      // The studio module loads lazily, after mount.
      await screen.findByRole(
        "heading",
        { name: "Rehearsal" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
  });
});
