import type { PlatformDatabase } from "@omnitech/database";
import { expect, it } from "vitest";
import { createPresentationApi } from "./api";

// Characterisation: the routes the product mounts, in registration order. A
// refactor of the transport layer may not add, drop, rename or reorder one.
it("mounts exactly the presentation routes", () => {
  const api = createPresentationApi({
    database: {} as PlatformDatabase,
    resolveContext: async () => null,
  });
  expect(api.routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "ALL /presentation/v1/*",
    "GET /presentation/v1/documents",
    "POST /presentation/v1/documents",
    "GET /presentation/v1/shared/:token",
    "GET /presentation/v1/documents/:id",
    "PATCH /presentation/v1/documents/:id",
    "DELETE /presentation/v1/documents/:id",
    "POST /presentation/v1/documents/:id/duplicate",
    "PUT /presentation/v1/documents/:id/favorite",
    "PUT /presentation/v1/documents/:id/slides",
    "DELETE /presentation/v1/documents/:id/slides/:slideId",
    "PATCH /presentation/v1/documents/:id/slides/:slideId",
    "GET /presentation/v1/themes",
    "POST /presentation/v1/themes",
    "POST /presentation/v1/themes/import",
    "PUT /presentation/v1/themes/:id/:reaction",
    "GET /presentation/v1/images",
    "POST /presentation/v1/images",
    "POST /presentation/v1/generate/outline",
    "POST /presentation/v1/documents/:id/slides/generate",
    "POST /presentation/v1/images/generate",
    "POST /presentation/v1/documents/:id/shares",
    "DELETE /presentation/v1/shares/:id",
    "POST /presentation/v1/documents/:id/exports",
    "POST /presentation/v1/documents/:id/recordings",
    "GET /presentation/v1/documents/:id/recordings",
  ]);
});

// Characterisation: who answers what when nobody is a member. Each route's own
// refusal is part of its contract (some say 401, the 400-class writes say 400).
it("answers each tenant route's own refusal without a membership", async () => {
  const api = createPresentationApi({
    database: {} as PlatformDatabase,
    resolveContext: async () => null,
  });
  const refusals: Record<string, [number, string]> = {};
  for (const { method, path } of api.routes) {
    if (method === "ALL" || path.includes("/shared/")) continue;
    const response = await api.request(
      path.replace(":reaction", "like").replaceAll(/:\w+/g, "x"),
      {
        method,
        ...(method === "GET" || method === "DELETE"
          ? {}
          : { body: "{}", headers: { "content-type": "application/json" } }),
      },
    );
    refusals[`${method} ${path}`] = [
      response.status,
      ((await response.json()) as { error: string }).error,
    ];
  }
  expect(refusals).toMatchInlineSnapshot(`
    {
      "DELETE /presentation/v1/documents/:id": [
        401,
        "Unauthorized",
      ],
      "DELETE /presentation/v1/documents/:id/slides/:slideId": [
        400,
        "Unable to delete slide.",
      ],
      "DELETE /presentation/v1/shares/:id": [
        400,
        "Unable to revoke share.",
      ],
      "GET /presentation/v1/documents": [
        401,
        "Unauthorized",
      ],
      "GET /presentation/v1/documents/:id": [
        401,
        "Unauthorized",
      ],
      "GET /presentation/v1/documents/:id/recordings": [
        400,
        "Unable to load recordings.",
      ],
      "GET /presentation/v1/images": [
        401,
        "Unauthorized",
      ],
      "GET /presentation/v1/themes": [
        401,
        "Unauthorized",
      ],
      "PATCH /presentation/v1/documents/:id": [
        401,
        "Unauthorized",
      ],
      "PATCH /presentation/v1/documents/:id/slides/:slideId": [
        400,
        "Unable to move slide.",
      ],
      "POST /presentation/v1/documents": [
        401,
        "Unauthorized",
      ],
      "POST /presentation/v1/documents/:id/duplicate": [
        400,
        "Unable to duplicate presentation.",
      ],
      "POST /presentation/v1/documents/:id/exports": [
        400,
        "Export failed.",
      ],
      "POST /presentation/v1/documents/:id/recordings": [
        400,
        "Invalid recording.",
      ],
      "POST /presentation/v1/documents/:id/shares": [
        400,
        "Unable to create share.",
      ],
      "POST /presentation/v1/documents/:id/slides/generate": [
        503,
        "AI is not configured.",
      ],
      "POST /presentation/v1/generate/outline": [
        503,
        "AI is not configured.",
      ],
      "POST /presentation/v1/images": [
        400,
        "Unable to save image.",
      ],
      "POST /presentation/v1/images/generate": [
        503,
        "AI is not configured.",
      ],
      "POST /presentation/v1/themes": [
        400,
        "Invalid theme.",
      ],
      "POST /presentation/v1/themes/import": [
        400,
        "The PowerPoint file could not be read as a theme.",
      ],
      "PUT /presentation/v1/documents/:id/favorite": [
        400,
        "Unable to update favorite.",
      ],
      "PUT /presentation/v1/documents/:id/slides": [
        401,
        "Unauthorized",
      ],
      "PUT /presentation/v1/themes/:id/:reaction": [
        400,
        "Invalid theme reaction.",
      ],
    }
  `);
});
