import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConnectedAccountVault } from "./connected-account-vault.js";
import { PlatformRepository } from "./platform-repository.js";

// The repository runs as fixture_member, a NOSUPERUSER NOBYPASSRLS role, so
// installations are read under the same forced row-level security as the app.
let pg: DisposablePostgres;
let member: PlatformDatabase;
let repository: PlatformRepository;
let tenantId: string;

const installation = (order: number, route: string) => ({
  enabled: true,
  routePrefix: route,
  navigation: { group: "Products", order, hidden: false, routes: {} },
  featureFlags: {},
  settings: {},
  revision: 1,
});

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform TO fixture_member;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform TO fixture_member;`);
  const tenant = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North Lab') RETURNING id",
  );
  tenantId = tenant.rows[0]!.id;
  await pg.owner.query(
    `INSERT INTO platform.product_installations
       (tenant_id, product_id, display_name, description, icon, sort_order,
        enabled, configuration)
     VALUES
       ($1, 'omnitech.presentation', 'Decks', 'Slides.', 'presentation', 20, true, $2),
       ($1, 'omnitech.interview', 'Interview', 'Practise.', 'sparkles', 10, true, $3),
       ($1, 'omnitech.retired', 'Retired', 'Old.', 'archive', 5, false, $4)`,
    [
      tenantId,
      installation(20, "/p/presentation"),
      installation(10, "/p/interview"),
      installation(5, "/p/retired"),
    ],
  );
  member = createPlatformDatabase(pg.memberUrl);
  repository = new PlatformRepository(member);
}, 30_000);
afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

async function join(userId: string, role: "owner" | "admin" | "member") {
  await pg.owner.query(
    `INSERT INTO platform.tenant_memberships (tenant_id, user_id, role)
     VALUES ($1, $2, $3)`,
    [tenantId, userId, role],
  );
}

describe("platform repository", () => {
  it("signs a person in once per identity and updates their profile", async () => {
    const first = await repository.upsertIdentity({
      provider: "google",
      providerAccountId: "google-ada",
      email: "ada@example.test",
      displayName: "Ada",
      avatarUrl: null,
    });
    const again = await repository.upsertIdentity({
      provider: "linkedin",
      providerAccountId: "linkedin-ada",
      email: "ada@example.test",
      displayName: "Ada Lovelace",
      avatarUrl: "https://example.test/ada.png",
    });

    expect(again).toBe(first);
    const identities = await pg.owner.query<{ provider: string }>(
      "SELECT provider FROM platform.login_identities WHERE user_id = $1 ORDER BY provider",
      [first],
    );
    expect(identities.rows.map((row) => row.provider)).toEqual([
      "google",
      "linkedin",
    ]);
  });

  it("resolves a member's tenant context with its enabled products in order", async () => {
    const userId = await repository.upsertIdentity({
      provider: "google",
      providerAccountId: "google-grace",
      email: "grace@example.test",
      displayName: "Grace",
      avatarUrl: "https://example.test/grace.png",
    });
    await join(userId, "owner");

    const context = await repository.resolveContext(
      "grace@example.test",
      "north",
    );

    expect(context).toMatchObject({
      user: {
        id: userId,
        email: "grace@example.test",
        displayName: "Grace",
        avatarUrl: "https://example.test/grace.png",
      },
      tenant: { id: tenantId, slug: "north", name: "North Lab" },
      membership: { tenantId, userId, role: "owner" },
      // No saved preferences yet: the defaults apply.
      preferences: { theme: "system", locale: "en" },
    });
    expect(context?.preferences).not.toHaveProperty("aiProfileId");
    expect(context?.permissions).toContain("tenant.delete");
    expect(context?.products.map((product) => product.productId)).toEqual([
      "omnitech.interview",
      "omnitech.presentation",
    ]);
    expect(context?.products[0]).toMatchObject({
      name: "Interview",
      description: "Practise.",
      icon: "sparkles",
      routePrefix: "/p/interview",
    });
  });

  it("grants permissions by membership role", async () => {
    const permissionsFor = async (email: string, role: "admin" | "member") => {
      const userId = await repository.upsertIdentity({
        provider: "google",
        providerAccountId: `google-${email}`,
        email,
        displayName: email,
        avatarUrl: null,
      });
      await join(userId, role);
      return (await repository.resolveContext(email, "north"))?.permissions;
    };

    const admin = await permissionsFor("admin@example.test", "admin");
    const member = await permissionsFor("member@example.test", "member");

    expect(admin).toContain("tenant.manage");
    expect(admin).not.toContain("tenant.delete");
    expect(member).toEqual([
      "platform.read",
      "artifact.read",
      "interview.read",
      "interview.documents.write",
      "presentation.read",
    ]);
  });

  it("refuses a context for a tenant the person does not belong to", async () => {
    expect(
      await repository.resolveContext("ada@example.test", "north"),
    ).toBeNull();
    expect(
      await repository.resolveContext("nobody@example.test", "north"),
    ).toBeNull();
  });

  it("saves preferences and applies them to the next resolved context", async () => {
    const userId = await repository.upsertIdentity({
      provider: "google",
      providerAccountId: "google-linus",
      email: "linus@example.test",
      displayName: "Linus",
      avatarUrl: null,
    });
    await join(userId, "member");

    await repository.savePreferences(userId, {
      theme: "dark",
      locale: "fr",
      aiProfileId: "writer",
    });
    const chosen = await repository.resolveContext(
      "linus@example.test",
      "north",
    );
    await repository.savePreferences(userId, { theme: "light", locale: "en" });
    const cleared = await repository.resolveContext(
      "linus@example.test",
      "north",
    );

    expect(chosen?.preferences).toEqual({
      theme: "dark",
      locale: "fr",
      aiProfileId: "writer",
    });
    expect(cleared?.preferences).toEqual({ theme: "light", locale: "en" });
  });

  it("stores a connected account's tokens encrypted and replaces them on reconnect", async () => {
    const userId = await repository.upsertIdentity({
      provider: "google",
      providerAccountId: "google-barbara",
      email: "barbara@example.test",
      displayName: "Barbara",
      avatarUrl: null,
    });
    const vault = new ConnectedAccountVault("s".repeat(32));
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");

    await repository.saveConnectedAccount({
      userId,
      provider: "google",
      providerAccountId: "drive-1",
      scopes: ["openid"],
      accessToken: vault.encrypt("access-1"),
      refreshToken: vault.encrypt("refresh-1"),
      expiresAt,
    });
    await repository.saveConnectedAccount({
      userId,
      provider: "google",
      providerAccountId: "drive-2",
      scopes: ["openid", "drive.file"],
      accessToken: vault.encrypt("access-2"),
      refreshToken: null,
      expiresAt: null,
    });

    const accounts = await pg.owner.query<{
      provider_account_id: string;
      status: string;
      scopes: string[];
      access_token_ciphertext: unknown;
      refresh_token_ciphertext: unknown;
      expires_at: Date | null;
    }>("SELECT * FROM platform.connected_accounts WHERE user_id = $1", [
      userId,
    ]);
    expect(accounts.rows).toHaveLength(1);
    const account = accounts.rows[0]!;
    expect(account).toMatchObject({
      provider_account_id: "drive-2",
      status: "connected",
      scopes: ["openid", "drive.file"],
      refresh_token_ciphertext: null,
      expires_at: null,
    });
    expect(JSON.stringify(account)).not.toContain("access-2");
    expect(vault.decrypt(account.access_token_ciphertext)).toBe("access-2");
  });
});
