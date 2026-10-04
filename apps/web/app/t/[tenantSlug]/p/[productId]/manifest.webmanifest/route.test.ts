import { describe, expect, it } from "vitest";
import { liveWebAppManifest } from "@/src/platform/web-app-manifest";
import { GET } from "./route";

const call = (tenantSlug: string, productId: string) =>
  GET(new Request("http://127.0.0.1:3100/x"), {
    params: Promise.resolve({ tenantSlug, productId }),
  });

describe("the live web app manifest", () => {
  it("is installable: standalone, a start_url inside its scope, 192 and 512 icons", () => {
    const manifest = liveWebAppManifest("local");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe(
      "/t/local/p/interview/live/overlay?host=pwa",
    );
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.scope).toBe("/t/local/p/interview/");
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.every((icon) => icon.src.startsWith("/icons/"))).toBe(
      true,
    );
  });

  it("is served as a manifest for the interview product only", async () => {
    const ok = await call("local", "interview");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/manifest+json");
    expect((await ok.json()).scope).toBe("/t/local/p/interview/");
    expect((await call("local", "presentation")).status).toBe(404);
    expect((await call("../etc", "interview")).status).toBe(404);
  });

  it("carries no session, credential or content", async () => {
    const text = JSON.stringify(liveWebAppManifest("acme"));
    expect(text).not.toMatch(/session=|asc_|token|secret/i);
  });
});
