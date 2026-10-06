import { z } from "zod";

export const userPreferencesSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
  locale: z.string().trim().min(2),
  aiProfileId: z.string().trim().min(1).nullable().optional(),
});

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
    id: z.uuid(),
    email: z.email(),
    displayName: z.string(),
    avatarUrl: z.url().nullable(),
  }),
  tenant: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
  }),
  membership: z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
    role: z.enum(["owner", "admin", "member"]),
  }),
  preferences: userPreferencesSchema,
  permissions: z.array(z.string()),
  products: z.array(installedProductSummarySchema),
});

export type PlatformContext = z.infer<typeof platformContextSchema>;
