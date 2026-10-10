import {
  parsePlaygroundExplanation,
  parsePlaygroundPatch,
} from "@omnitech/interview-playground-control";
import { PlaygroundGuideInvalidError } from "./domain/playground-answer";
import {
  appendExplanation,
  readPlayground,
  resetPlayground,
  updatePlayground,
} from "./services/playground.service";
import {
  type ApiApp,
  apiError,
  JSON_BODY_LIMIT_BYTES,
  readBody,
} from "./transport";

export function mountPlaygroundRoutes(app: ApiApp) {
  app.get("/api/v1/playground-control", (context) =>
    context.json(readPlayground()),
  );

  app.patch("/api/v1/playground-control", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    try {
      return context.json(updatePlayground(parsePlaygroundPatch(body.value)));
    } catch (error) {
      // The parser's messages quote the pushed fields, so they stay out of the
      // response; a bad guide is named by its schema path.
      return apiError(
        context,
        400,
        "invalid_playground_update",
        "The Playground update is invalid.",
        error instanceof PlaygroundGuideInvalidError ? [error.path] : undefined,
      );
    }
  });

  app.post("/api/v1/playground-control/explanations", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    try {
      return context.json(
        appendExplanation(parsePlaygroundExplanation(body.value)),
      );
    } catch {
      return apiError(
        context,
        400,
        "invalid_explanation_append",
        "The Playground explanation is invalid.",
      );
    }
  });

  app.delete("/api/v1/playground-control", (context) =>
    context.json(resetPlayground()),
  );
}
