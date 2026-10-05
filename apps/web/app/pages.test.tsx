// @vitest-environment node
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getPlatformDatabase } from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  grantApplicationRole,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { signIntegrationState } from "@omnitech/platform-integrations";
import type { ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The sign-in session (NextAuth) is the identity boundary; local development
// signs in through FAKE_AUTH_ENABLED instead.
vi.mock("@/auth", () => ({ auth: async () => null }));

const storageRoot = fileURLToPath(
  new URL("../../../packages/platform-storage", import.meta.url),
);
let pg: DisposablePostgres;
let local: { tenantId: string; userId: string };
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await grantApplicationRole(pg.owner);
  await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "src/bootstrap.ts"],
    { cwd: storageRoot, env: { ...process.env, DATABASE_URL: pg.memberUrl } },
  );
  const row = (
    await pg.owner.query<{ tenant_id: string; user_id: string }>(
      "SELECT tenant_id, user_id FROM platform.tenant_memberships",
    )
  ).rows[0]!;
  local = { tenantId: row.tenant_id, userId: row.user_id };
  vi.stubEnv("DATABASE_URL", pg.memberUrl);
  vi.stubEnv("FAKE_AUTH_ENABLED", "true");
}, 90_000);
afterAll(async () => {
  await getPlatformDatabase()
    .close()
    .catch(() => undefined);
  await pg?.stop();
  vi.unstubAllEnvs();
});

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
// Every link and line of text a server component's element tree carries.
function contentOf(node: unknown): { text: string[]; hrefs: string[] } {
  const found = { text: [] as string[], hrefs: [] as string[] };
  const visit = (value: unknown) => {
    if (typeof value === "string") found.text.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object" && "props" in value) {
      const props = (
        value as ReactElement<{ href?: string; children?: unknown }>
      ).props;
      if (props.href) found.hrefs.push(props.href);
      visit(props.children);
    }
  };
  visit(node);
  return found;
}

// Next.js ends a render with notFound() or redirect() by throwing; the digest
// says which, and where to.
async function digestOf(render: () => unknown) {
  try {
    await render();
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  return undefined;
}

describe("a product page", () => {
  it("renders the product's entry for an installed route", async () => {
    const { default: ProductPage } = await import(
      "./t/[tenantSlug]/p/[productId]/[[...productPath]]/page"
    );
    const page = (await ProductPage(
      params({
        tenantSlug: "local",
        productId: "interview",
        productPath: ["briefings", "pack-1"],
      }),
    )) as ReactElement;
    expect((page.type as { name: string }).name).toBe("StudioRoute");
    // The page also receives the tenant's installed products, so Interview
    // can offer a way to Presentation (and mark itself as the current one).
    expect(page.props).toEqual({
      pathSegments: ["briefings", "pack-1"],
      routeId: "interview.briefings",
      tenantSlug: "local",
      products: [
        expect.objectContaining({
          productId: "omnitech.interview",
          href: "/t/local/p/interview",
          current: true,
        }),
        expect.objectContaining({
          productId: "omnitech.presentation",
          href: "/t/local/p/presentation",
          current: false,
        }),
      ],
    });

    // The product's root is its home route.
    const home = (await ProductPage(
      params({ tenantSlug: "local", productId: "interview" }),
    )) as ReactElement<{ routeId: string }>;
    expect(home.props.routeId).toBe("interview.home");
  });

  it("is not found for a non-member, an unknown product or route", async () => {
    const { default: ProductPage } = await import(
      "./t/[tenantSlug]/p/[productId]/[[...productPath]]/page"
    );
    for (const request of [
      { tenantSlug: "other", productId: "interview" },
      { tenantSlug: "local", productId: "unknown" },
      { tenantSlug: "local", productId: "interview", productPath: ["nope"] },
    ])
      expect(await digestOf(() => ProductPage(params(request)))).toBe(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
  });
});

describe("the tenant's pages", () => {
  it("frames them in the shell with each product's registered frame", async () => {
    const { default: TenantLayout } = await import("./t/[tenantSlug]/layout");
    const layout = (await TenantLayout({
      children: "page",
      ...params({ tenantSlug: "local" }),
    })) as ReactElement<{
      context: { tenant: { slug: string } };
      frames: Record<string, string>;
      children: string;
    }>;
    expect(layout.props.context.tenant.slug).toBe("local");
    expect(layout.props.frames).toMatchObject({
      interview: "fill-viewport",
      "omnitech.interview": "fill-viewport",
      presentation: "dark",
    });
    expect(layout.props.children).toBe("page");
    expect(
      await digestOf(() =>
        TenantLayout({ children: null, ...params({ tenantSlug: "other" }) }),
      ),
    ).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("send the root and a tenant's root to Interview Studio", async () => {
    const { default: RootPage } = await import("./page");
    const { default: TenantPage } = await import("./t/[tenantSlug]/page");
    expect(await digestOf(() => RootPage())).toMatch(
      /^NEXT_REDIRECT;replace;\/t\/local\/p\/interview;307;/,
    );
    expect(
      await digestOf(() => TenantPage(params({ tenantSlug: "acme" }))),
    ).toMatch(/^NEXT_REDIRECT;replace;\/t\/acme\/p\/interview;307;/);
  });

  it("offer connected accounts in the tenant's settings", async () => {
    const { default: IntegrationsPage } = await import(
      "./t/[tenantSlug]/settings/integrations/page"
    );
    const page = contentOf(
      await IntegrationsPage(params({ tenantSlug: "local" })),
    );
    expect(page.text).toContain("Connected accounts");
    expect(page.hrefs).toEqual([
      "/api/integrations/google/authorize?tenant=local",
      "/api/integrations/linkedin/authorize?tenant=local",
    ]);
    expect(
      await digestOf(() => IntegrationsPage(params({ tenantSlug: "other" }))),
    ).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("open a shared presentation by its token", async () => {
    const { default: SharedPage } = await import(
      "./share/presentation/[token]/page"
    );
    const page = (await SharedPage(
      params({ token: "share-token" }),
    )) as ReactElement;
    expect(page.props).toEqual({
      pathSegments: ["shared", "share-token"],
      // A public link opens outside any tenant: no products to switch to.
      products: [],
      routeId: "presentation.shared",
      tenantSlug: "",
    });
  });
});

describe("connecting an account", () => {
  const STATE_SECRET = "integration-state-secret-at-least-32";
  const callback = async (provider: string, state: string) => {
    const { GET } = await import(
      "./api/integrations/[provider]/callback/route"
    );
    return GET(
      new Request(
        `https://app.test/api/integrations/${provider}/callback?code=the-code&state=${state}`,
      ),
      params({ provider }),
    );
  };
  const stateFor = (provider: string, userId = local.userId) =>
    signIntegrationState(
      {
        provider: provider as "google",
        tenantId: local.tenantId,
        tenantSlug: "local",
        userId,
        expiresAt: Date.now() + 60_000,
      },
      STATE_SECRET,
    );

  it("stores the provider's grant for the member and returns to settings", async () => {
    vi.stubEnv("INTEGRATION_STATE_SECRET", STATE_SECRET);
    vi.stubEnv(
      "CONNECTED_ACCOUNT_SECRET",
      "connected-account-secret-at-least-32",
    );
    vi.stubEnv("INTEGRATION_LINKEDIN_ID", "client-id");
    vi.stubEnv("INTEGRATION_LINKEDIN_SECRET", "client-secret");
    // LinkedIn's token and profile endpoints.
    const provider = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/accessToken")
        ? Response.json({
            access_token: "access",
            refresh_token: "refresh",
            expires_in: 3600,
            scope: "openid profile",
          })
        : Response.json({ sub: "linkedin-member-7" }),
    );
    vi.stubGlobal("fetch", provider);
    try {
      const response = await callback("linkedin", stateFor("linkedin"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://app.test/t/local/settings/integrations",
      );
      const saved = await pg.owner.query<{
        provider_account_id: string;
        scopes: string[];
        access_token_ciphertext: unknown;
      }>(
        "SELECT provider_account_id, scopes, access_token_ciphertext FROM platform.connected_accounts WHERE user_id = $1",
        [local.userId],
      );
      expect(saved.rows[0]).toMatchObject({
        provider_account_id: "linkedin-member-7",
        scopes: ["openid", "profile"],
      });
      // [SAFETY] Tokens are stored encrypted, never as sent.
      expect(
        JSON.stringify(saved.rows[0]?.access_token_ciphertext),
      ).not.toContain('"access"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a state minted for another member", async () => {
    vi.stubEnv("INTEGRATION_STATE_SECRET", STATE_SECRET);
    vi.stubEnv(
      "CONNECTED_ACCOUNT_SECRET",
      "connected-account-secret-at-least-32",
    );
    const response = await callback(
      "google",
      stateFor("google", "00000000-0000-4000-8000-0000000000aa"),
    );
    expect(response.status).toBe(403);
    // The provider in the URL must be the one the state was minted for.
    expect((await callback("linkedin", stateFor("google"))).status).toBe(403);
  });

  it("rejects an incomplete callback", async () => {
    vi.stubEnv("INTEGRATION_STATE_SECRET", STATE_SECRET);
    expect((await callback("github", "state")).status).toBe(400);
    expect((await callback("google", "")).status).toBe(400);
  });
});
