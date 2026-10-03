import type { ComponentType } from "react";
import { z } from "zod";

export const productRouteManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  defaultPath: z.string().startsWith("/"),
  frontendEntry: z.string().trim().min(1),
  requiredPermission: z.string().trim().min(1),
  apiEntries: z.array(z.string().trim().min(1)).optional(),
  featureFlag: z.string().trim().min(1).optional(),
});

export const navigationManifestSchema = z.object({
  routeId: z.string().trim().min(1),
  defaultLabel: z.string().trim().min(1),
  defaultDescription: z.string().trim().min(1),
  group: z.string().trim().min(1),
  order: z.number().int(),
});

// How the shell frames a product's pages: the standard page, a dark page,
// or a page that fills the viewport. Products choose it at registration.
export const productFrameSchema = z.enum(["standard", "dark", "fill-viewport"]);

export const productManifestSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  platformVersion: z.string().trim().min(1),
  defaultName: z.string().trim().min(1),
  defaultDescription: z.string().trim().min(1),
  icon: z.string().trim().min(1),
  frame: productFrameSchema.optional(),
  permissions: z.array(z.string().trim().min(1)),
  routes: z.array(productRouteManifestSchema).min(1),
  navigation: z.array(navigationManifestSchema),
  configurationSchema: z.record(z.string(), z.unknown()),
  capabilities: z.array(z.string().trim().min(1)).optional(),
  backgroundJobs: z.array(z.string().trim().min(1)).optional(),
  migrationVersion: z.number().int().nonnegative().optional(),
  commandPalette: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        routeId: z.string().trim().min(1),
        defaultLabel: z.string().trim().min(1),
      }),
    )
    .optional(),
});

export type ProductRouteManifest = z.infer<typeof productRouteManifestSchema>;
export type NavigationManifest = z.infer<typeof navigationManifestSchema>;
export type ProductManifest = z.infer<typeof productManifestSchema>;
export type ProductFrame = z.infer<typeof productFrameSchema>;

export interface ProductPageProps {
  tenantSlug: string;
  routeId: string;
  pathSegments: readonly string[];
}

export type ProductPageLoader = () => Promise<{
  default: ComponentType<ProductPageProps>;
}>;

export interface ProductFrontendPlugin {
  id: string;
  routes: Readonly<Record<string, ProductPageLoader>>;
}

export interface ProductApiPlugin {
  id: string;
  mountPath: string;
}
