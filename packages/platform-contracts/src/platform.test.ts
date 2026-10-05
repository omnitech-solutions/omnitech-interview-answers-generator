import { describe, expect, it } from "vitest";
import { platformContextSchema, userPreferencesSchema } from "./index";

const context = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "ada@example.test",
    displayName: "Ada",
    avatarUrl: null,
  },
  tenant: {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "north",
    name: "North Lab",
  },
  membership: {
    tenantId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
  },
  preferences: { theme: "dark", locale: "en" },
  permissions: ["platform.read"],
  products: [
    {
      productId: "omnitech.interview",
      name: "Interview",
      description: "Practise interviews.",
      icon: "sparkles",
      enabled: true,
      routePrefix: "/p/interview",
      navigation: {
        group: "Products",
        order: 10,
        hidden: false,
        routes: {
          "interview.home": {
            label: "Interview Studio",
            description: "Prepare and rehearse",
            path: "/p/interview",
            hidden: false,
          },
        },
      },
      featureFlags: { sharing: true },
      settings: { theme: "night", seats: 3, beta: false, retired: null },
      revision: 1,
    },
  ],
};

describe("platform context contract", () => {
  it("accepts a member's resolved context with an installed product", () => {
    expect(platformContextSchema.parse(context)).toEqual(context);
  });

  it("rejects a product route outside the tenant's product paths", () => {
    const product = context.products[0]!;
    const relative = {
      ...context,
      products: [{ ...product, routePrefix: "p/interview" }],
    };

    expect(platformContextSchema.safeParse(relative).success).toBe(false);
  });

  it("validates preference updates", () => {
    expect(
      userPreferencesSchema.parse({
        theme: "light",
        locale: " fr ",
        aiProfileId: null,
      }),
    ).toEqual({ theme: "light", locale: "fr", aiProfileId: null });
    expect(
      userPreferencesSchema.safeParse({ theme: "neon", locale: "en" }).success,
    ).toBe(false);
  });
});
