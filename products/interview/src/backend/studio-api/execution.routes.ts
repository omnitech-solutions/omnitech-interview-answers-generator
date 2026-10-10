import {
  runAllRequestSchema,
  runRequestSchema,
  syntaxCheckRequestSchema,
} from "@omnitech/interview-contracts";
import type { Context } from "hono";
import {
  PreviewCompileError,
  PreviewImportRefusedError,
} from "../react-preview";
import { exceedsExecutionBounds } from "./domain/execution";
import * as execution from "./services/execution.service";
import {
  type ApiApp,
  type ApiEnvironment,
  apiError,
  EXECUTION_BODY_LIMIT_BYTES,
  logFailure,
  readBody,
} from "./transport";

function executionTooLarge(context: Context<ApiEnvironment>) {
  return apiError(
    context,
    413,
    "payload_too_large",
    "The code or input is too large to run.",
  );
}

export function mountExecutionRoutes(app: ApiApp) {
  app.post("/api/v1/run", async (context) => {
    const body = await readBody(context, EXECUTION_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = runRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The execution request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    if (exceedsExecutionBounds(parsed.data)) return executionTooLarge(context);
    try {
      return context.json(await execution.run(parsed.data));
    } catch {
      return apiError(
        context,
        503,
        "runner_unavailable",
        "The code runner is unavailable. Start Docker Desktop, wait until it is running, then try again.",
      );
    }
  });

  app.post("/api/v1/syntax-check", async (context) => {
    const body = await readBody(context, EXECUTION_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = syntaxCheckRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The syntax-check request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    if (exceedsExecutionBounds(parsed.data)) return executionTooLarge(context);
    try {
      return context.json(await execution.checkSyntax(parsed.data));
    } catch {
      return apiError(
        context,
        503,
        "runner_unavailable",
        "The syntax checker is unavailable. Start Docker Desktop, then try again.",
      );
    }
  });

  app.post("/api/v1/run-all", async (context) => {
    const body = await readBody(context, EXECUTION_BODY_LIMIT_BYTES);
    if (!body.ok) return body.response;
    const parsed = runAllRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        context,
        400,
        "invalid_request",
        "The complete execution request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    if (exceedsExecutionBounds(parsed.data)) return executionTooLarge(context);
    try {
      return context.json(await execution.runAll(parsed.data));
    } catch {
      return apiError(
        context,
        503,
        "runner_unavailable",
        "The framework runner is unavailable. Build the local runner images with pnpm runner:build, then try again.",
      );
    }
  });

  app.post("/api/v1/react-preview", async (context) => {
    const read = await readBody(context, EXECUTION_BODY_LIMIT_BYTES);
    if (!read.ok) return read.response;
    const body = (read.value ?? {}) as {
      code?: unknown;
      componentName?: unknown;
    };
    if (typeof body.code !== "string" || body.code.trim() === "") {
      return apiError(
        context,
        400,
        "invalid_request",
        "React preview requires non-empty code.",
      );
    }
    if (exceedsExecutionBounds({ code: body.code })) {
      return executionTooLarge(context);
    }
    try {
      return context.json(
        await execution.preview(body.code, body.componentName),
      );
    } catch (error) {
      logFailure(context, "react-preview", error);
      return apiError(
        context,
        400,
        "compile_failed",
        error instanceof PreviewImportRefusedError ||
          error instanceof PreviewCompileError
          ? error.message
          : "The preview code could not be compiled.",
      );
    }
  });
}
