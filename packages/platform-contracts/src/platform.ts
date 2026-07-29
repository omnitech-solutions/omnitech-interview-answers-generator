import { z } from "zod";

export const userPreferencesSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
  locale: z.string().trim().min(2),
});

export interface PlatformUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AuthenticatedUser extends PlatformUser {
  sessionId: string;
}

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
}

export interface TenantMembership {
  tenantId: string;
  userId: string;
  role: "owner" | "admin" | "member";
}

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

const productNavigationRouteConfigurationSchema = z.object({
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  path: z.string().startsWith("/"),
  hidden: z.boolean(),
});

export const productInstallationConfigurationSchema = z.object({
  enabled: z.boolean(),
  routePrefix: z.string().startsWith("/"),
  navigation: z.object({
    group: z.string().trim().min(1),
    order: z.number().int(),
    hidden: z.boolean(),
    routes: z.record(z.string(), productNavigationRouteConfigurationSchema),
  }),
  featureFlags: z.record(z.string(), z.boolean()),
  settings: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  revision: z.number().int().positive(),
});

export type ProductInstallationConfiguration = z.infer<
  typeof productInstallationConfigurationSchema
>;

export const installedProductSummarySchema =
  productInstallationConfigurationSchema.extend({
    productId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    icon: z.string().trim().min(1),
  });

export type InstalledProductSummary = z.infer<
  typeof installedProductSummarySchema
>;

export const platformContextSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
    avatarUrl: z.string().url().nullable(),
  }),
  tenant: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  }),
  membership: z.object({
    tenantId: z.string().uuid(),
    userId: z.string().uuid(),
    role: z.enum(["owner", "admin", "member"]),
  }),
  preferences: userPreferencesSchema,
  permissions: z.array(z.string()),
  products: z.array(installedProductSummarySchema),
});

export type PlatformContext = z.infer<typeof platformContextSchema>;

export const connectedAccountSummarySchema = z.object({
  provider: z.enum(["google", "linkedin"]),
  status: z.enum(["connected", "expired", "revoked"]),
  scopes: z.array(z.string()),
  expiresAt: z.string().datetime().nullable(),
});

export type ConnectedAccountSummary = z.infer<
  typeof connectedAccountSummarySchema
>;

export const artifactMetadataSchema = z.object({
  tags: z.array(z.string()),
  summary: z.string().nullable(),
  thumbnailUrl: z.string().url().nullable(),
});

export type ArtifactMetadata = z.infer<typeof artifactMetadataSchema>;

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.string()).optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
