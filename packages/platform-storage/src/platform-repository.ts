import { enterTenant, type PlatformDatabase } from "@omnitech/database";
import type {
  InstalledProductSummary,
  PlatformContext,
  UserPreferences,
} from "@omnitech/platform-contracts";
import type { EncryptedValue } from "./connected-account-vault";
import { type ContextRow, toPlatformContext } from "./platform-context";

type InstallationRow = {
  product_id: string;
  display_name: string;
  description: string;
  icon: string;
  configuration: InstalledProductSummary;
};

export interface IdentityProfile {
  provider: "google" | "linkedin";
  providerAccountId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

// People, sign-in identities, preferences, connected accounts and a tenant's
// installed products. What a context grants is decided in ./platform-context.
// Raw by necessity: users, identities, preferences and connected accounts are
// not tenant-owned and a context's tenant is known only after its first read,
// while the database package hands out a Drizzle handle only for a known
// tenant and actor (withTenant). The upserts name their conflict targets.
export class PlatformRepository {
  constructor(private readonly database: PlatformDatabase) {}

  async upsertIdentity(profile: IdentityProfile): Promise<string> {
    return this.database.transaction(async (client) => {
      const user = await client.query<{ id: string }>(
        `INSERT INTO platform.users (email, display_name, avatar_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           avatar_url = EXCLUDED.avatar_url,
           updated_at = now()
         RETURNING id`,
        [profile.email, profile.displayName, profile.avatarUrl],
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new Error("Identity upsert did not return a user.");
      await client.query(
        `INSERT INTO platform.login_identities
           (user_id, provider, provider_account_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, provider_account_id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           updated_at = now()`,
        [userId, profile.provider, profile.providerAccountId],
      );
      return userId;
    });
  }

  async resolveContext(
    email: string,
    tenantSlug: string,
  ): Promise<PlatformContext | null> {
    // [SAFETY] Memberships are tenant-owned rows under forced row-level
    // security: the person and the slug's tenant are found first, then the
    // membership is read inside that tenant.
    const row = await this.database.transaction(async (client) => {
      const candidate = await client.query<Omit<ContextRow, "role">>(
        `SELECT
           u.id AS user_id, u.email, u.display_name, u.avatar_url,
           t.id AS tenant_id, t.slug AS tenant_slug, t.name AS tenant_name,
           p.theme, p.locale, p.ai_profile_id
         FROM platform.users u
         CROSS JOIN platform.tenants t
         LEFT JOIN platform.user_preferences p ON p.user_id = u.id
         WHERE u.email = $1 AND t.slug = $2`,
        [email, tenantSlug],
      );
      const found = candidate.rows[0];
      if (!found) return undefined;
      await enterTenant(client, {
        tenantId: found.tenant_id,
        actorId: found.user_id,
      });
      const membership = await client.query<Pick<ContextRow, "role">>(
        `SELECT role FROM platform.tenant_memberships
         WHERE tenant_id = $1 AND user_id = $2`,
        [found.tenant_id, found.user_id],
      );
      const role = membership.rows[0]?.role;
      return role ? { ...found, role } : undefined;
    });
    if (!row) return null;
    return toPlatformContext(
      row,
      await this.listInstalledProducts(row.tenant_id),
    );
  }

  async listInstalledProducts(
    tenantId: string,
  ): Promise<InstalledProductSummary[]> {
    return this.database.tenantTransaction(tenantId, async (client) => {
      const result = await client.query<InstallationRow>(
        `SELECT product_id, display_name, description, icon, configuration
         FROM platform.product_installations
         WHERE tenant_id = $1 AND enabled = true
         ORDER BY sort_order, product_id`,
        [tenantId],
      );
      return result.rows.map((row) => ({
        ...row.configuration,
        productId: row.product_id,
        name: row.display_name,
        description: row.description,
        icon: row.icon,
      }));
    });
  }

  async savePreferences(
    userId: string,
    preferences: UserPreferences,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO platform.user_preferences (user_id, theme, locale, ai_profile_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         theme = EXCLUDED.theme,
         locale = EXCLUDED.locale,
         ai_profile_id = EXCLUDED.ai_profile_id,
         updated_at = now()`,
      [
        userId,
        preferences.theme,
        preferences.locale,
        preferences.aiProfileId ?? null,
      ],
    );
  }

  async saveConnectedAccount(input: {
    userId: string;
    provider: "google" | "linkedin";
    providerAccountId: string;
    scopes: string[];
    accessToken: EncryptedValue;
    refreshToken: EncryptedValue | null;
    expiresAt: Date | null;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO platform.connected_accounts
         (user_id, provider, provider_account_id, status, scopes,
          access_token_ciphertext, refresh_token_ciphertext, expires_at)
       VALUES ($1, $2, $3, 'connected', $4, $5, $6, $7)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         provider_account_id = EXCLUDED.provider_account_id,
         status = 'connected',
         scopes = EXCLUDED.scopes,
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
      [
        input.userId,
        input.provider,
        input.providerAccountId,
        input.scopes,
        input.accessToken,
        input.refreshToken,
        input.expiresAt,
      ],
    );
  }
}
