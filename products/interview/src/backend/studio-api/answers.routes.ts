import { saveAnswerRequestSchema } from "@omnitech/interview-contracts";
// Saved answers are plain reads and writes of their store: no use case to
// coordinate, so the routes ask the repository directly.
import { answerRepository as answers } from "../services";
import { answerPagination } from "./domain/pagination";
import {
  type ApiApp,
  apiError,
  JSON_BODY_LIMIT_BYTES,
  readBody,
} from "./transport";

export function mountAnswerListRoute(app: ApiApp) {
  app.get("/api/v1/answers", async (context) => {
    const pageParam = context.req.query("page");
    const pageSizeParam = context.req.query("pageSize");
    const pagination = answerPagination(pageParam, pageSizeParam);
    if (pagination.kind === "all") {
      return context.json(await answers.list());
    }
    if (pagination.kind === "invalid") {
      return apiError(
        context,
        400,
        "invalid_request",
        "Pagination parameters are invalid.",
      );
    }
    return context.json(
      await answers.listPage(pagination.page, pagination.pageSize),
    );
  });
}

export function mountAnswerItemRoutes(app: ApiApp) {
  app.get("/api/v1/answers/:id", async (context) => {
    const answer = await answers.get(context.req.param("id"));
    return answer
      ? context.json(answer)
      : apiError(context, 404, "not_found", "The saved answer was not found.");
  });

  app.post("/api/v1/answers", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = saveAnswerRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The answer is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return context.json(await answers.save(parsed.data), 201);
  });

  app.delete("/api/v1/answers/:id", async (context) => {
    const deleted = await answers.delete(context.req.param("id"));
    return deleted
      ? context.json({ deleted: true })
      : apiError(context, 404, "not_found", "The saved answer was not found.");
  });
}
