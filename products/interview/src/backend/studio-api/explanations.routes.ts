import { saveExplanationRequestSchema } from "@omnitech/interview-contracts";
// Saved explanations are plain reads and writes of their store: no use case to
// coordinate, so the routes ask the repository directly.
import { explanationRepository as explanations } from "../services";
import {
  type ApiApp,
  apiError,
  JSON_BODY_LIMIT_BYTES,
  readBody,
} from "./transport";

export function mountExplanationRoutes(app: ApiApp) {
  app.get("/api/v1/explanations", async (context) =>
    context.json(await explanations.list()),
  );

  app.get("/api/v1/explanations/:id", async (context) => {
    const item = await explanations.get(context.req.param("id"));
    return item
      ? context.json(item)
      : apiError(
          context,
          404,
          "not_found",
          "The saved explanation was not found.",
        );
  });

  app.post("/api/v1/explanations", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = saveExplanationRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The explanation is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return context.json(await explanations.save(parsed.data), 201);
  });

  app.delete("/api/v1/explanations/:id", async (context) => {
    const deleted = await explanations.delete(context.req.param("id"));
    return deleted
      ? context.json({ deleted: true })
      : apiError(
          context,
          404,
          "not_found",
          "The saved explanation was not found.",
        );
  });
}
