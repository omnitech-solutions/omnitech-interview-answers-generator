import {
  libraryItemInputSchema,
  librarySearchQuerySchema,
} from "@omnitech/interview-contracts";
import {
  LibrarySlugConflictError,
  LibraryStateError,
} from "@omnitech/interview-storage";
import type { Context } from "hono";
import { LibraryIndexUnavailableError } from "../library-service";
import * as library from "./services/library.service";
import {
  type ApiApp,
  type ApiEnvironment,
  apiError,
  JSON_BODY_LIMIT_BYTES,
  readBody,
} from "./transport";

function queryList(context: Context<ApiEnvironment>, name: string): string[] {
  return (context.req.queries(name) ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseLibrarySearchQuery(context: Context<ApiEnvironment>) {
  return librarySearchQuerySchema.safeParse({
    query: context.req.query("q") ?? "",
    contentTypes: queryList(context, "type"),
    collections: queryList(context, "collection"),
    tags: queryList(context, "tag"),
    officialOnly: context.req.query("official") === "true",
    offset: Number(context.req.query("offset") ?? 0),
    limit: Number(context.req.query("limit") ?? 20),
  });
}

function libraryMutationError(
  context: Context<ApiEnvironment>,
  error: unknown,
) {
  if (error instanceof LibrarySlugConflictError) {
    return apiError(
      context,
      409,
      "slug_conflict",
      "A Library item with that slug already exists.",
    );
  }
  if (error instanceof LibraryStateError) {
    return apiError(
      context,
      409,
      "invalid_library_state",
      "The Library item cannot be changed in its current state.",
    );
  }
  if (error instanceof LibraryIndexUnavailableError) {
    return apiError(
      context,
      503,
      "library_index_unavailable",
      "The Library search index could not be loaded or rebuilt.",
    );
  }
  throw error;
}

export function mountLibraryRoutes(app: ApiApp) {
  app.get("/api/v1/library/search", async (context) => {
    const parsed = parseLibrarySearchQuery(context);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The Library search query is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(await library.search(parsed.data));
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.get("/api/v1/library/facets", async (context) => {
    try {
      return context.json(await library.facets());
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.get("/api/v1/library/items", async (context) => {
    try {
      const includeDrafts = context.req.query("drafts") === "true";
      return context.json(await library.listItems(includeDrafts));
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.get("/api/v1/library/items/:idOrSlug", async (context) => {
    try {
      const identifier = context.req.param("idOrSlug");
      const item = await library.getItem(
        identifier,
        context.req.query("draft") === "true",
      );
      return item
        ? context.json(item)
        : apiError(
            context,
            404,
            "not_found",
            "The Library item was not found.",
          );
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.post("/api/v1/library/items", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = libraryItemInputSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The Library item is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(await library.saveDraft(parsed.data), 201);
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.put("/api/v1/library/items/:id", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = libraryItemInputSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The Library item is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    try {
      return context.json(
        await library.saveDraft(parsed.data, context.req.param("id")),
      );
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.post("/api/v1/library/items/:id/publish", async (context) => {
    try {
      const item = await library.publish(context.req.param("id"));
      if (!item) {
        return apiError(
          context,
          404,
          "not_found",
          "The Library item was not found.",
        );
      }
      return context.json(item);
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.post("/api/v1/library/items/:id/archive", async (context) => {
    try {
      const item = await library.archive(context.req.param("id"));
      if (!item) {
        return apiError(
          context,
          404,
          "not_found",
          "The Library item was not found.",
        );
      }
      return context.json(item);
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });

  app.delete("/api/v1/library/items/:id", async (context) => {
    try {
      const deleted = await library.deleteDraft(context.req.param("id"));
      return deleted
        ? context.json({ deleted: true })
        : apiError(
            context,
            404,
            "not_found",
            "The Library item was not found.",
          );
    } catch (error) {
      return libraryMutationError(context, error);
    }
  });
}
