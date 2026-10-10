import {
  explanationRequestSchema,
  generateRequestSchema,
  routeQuestion,
  routeRequestSchema,
} from "@omnitech/interview-contracts";
import type { Context } from "hono";
import { generateExplanation, generateInterviewAnswer } from "../services";
import {
  type ApiApp,
  type ApiEnvironment,
  apiError,
  generationFailure,
  type InterviewApiOptions,
  JSON_BODY_LIMIT_BYTES,
  logFailure,
  readBody,
} from "./transport";

export function mountGenerationRoutes(
  app: ApiApp,
  options: InterviewApiOptions,
) {
  // Generation runs for the member the request resolves to, on the host's
  // model; either missing stops the request before any model call.
  async function generation(context: Context<ApiEnvironment>) {
    const scope = await options.resolveScope(context.req.raw);
    if (!scope)
      return apiError(
        context,
        401,
        "unauthorized",
        "Sign in and name a tenant you belong to (x-omnitech-tenant).",
      );
    if (!options.generate)
      return apiError(
        context,
        503,
        "ai_not_configured",
        "No AI model is configured on this server.",
      );
    return { scope, generate: options.generate };
  }

  app.post("/api/v1/route", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = routeRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The routing request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return context.json(
      routeQuestion(parsed.data.question, parsed.data.language),
    );
  });

  app.post("/api/v1/generate", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = generateRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The generation request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    const ready = await generation(context);
    if (ready instanceof Response) return ready;
    try {
      return context.json(
        await generateInterviewAnswer(parsed.data, ready.generate, ready.scope),
      );
    } catch (error) {
      logFailure(context, "generate", error);
      return generationFailure(context, error, "an answer");
    }
  });

  app.post("/api/v1/explain", async (context) => {
    const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = explanationRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The explanation request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    const ready = await generation(context);
    if (ready instanceof Response) return ready;
    try {
      return context.json(
        await generateExplanation(parsed.data, ready.generate, ready.scope),
      );
    } catch (error) {
      logFailure(context, "explain", error);
      return generationFailure(context, error, "an explanation");
    }
  });
}
