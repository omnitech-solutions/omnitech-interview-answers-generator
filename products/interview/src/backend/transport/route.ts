import { createLogger } from "@omnitech/logging";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { BodyRefused, readJson } from "./body";

type ErrorClass = abstract new (...args: never[]) => unknown;
type Answer = readonly [status: ContentfulStatusCode, code: string];
export type Failures = {
  known?: readonly (readonly [ErrorClass, ...Answer])[];
  codes?: Readonly<Record<string, ContentfulStatusCode>>;
  log?: string;
  otherwise?: Answer;
};

const logger = createLogger({ service: "interview.transport" });
const uuid = z.uuid();

export function handle<C extends Context>(
  failures: Failures,
  work: (c: C) => Promise<Response>,
): (c: C) => Promise<Response> {
  return async (c) => {
    try {
      return await work(c);
    } catch (error) {
      const known = failures.known?.find(([type]) => error instanceof type);
      if (known) return c.json({ error: { code: known[2] } }, known[1]);
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      // Only a configured code can be echoed; never an arbitrary error message.
      if (
        typeof code === "string" &&
        failures.codes &&
        Object.hasOwn(failures.codes, code)
      ) {
        const status = failures.codes[code];
        if (status !== undefined) return c.json({ error: { code } }, status);
      }
      if (error instanceof BodyRefused)
        return c.json(
          { error: { code: error.code } },
          error.code === "body-too-large" ? 413 : 400,
        );
      if (error instanceof z.ZodError)
        return c.json({ error: { code: "invalid-request" } }, 400);
      if (failures.log)
        logger.error("route.failed", {
          route: failures.log,
          error: error instanceof Error ? error.constructor.name : "non-error",
        });
      if (!failures.otherwise) throw error;
      return c.json(
        { error: { code: failures.otherwise[1] } },
        failures.otherwise[0],
      );
    }
  };
}

export async function input<T>(
  c: Context,
  schema: z.ZodType<T>,
  limitBytes: number,
): Promise<T> {
  return schema.parse(await readJson(c.req.raw, limitBytes));
}

export function param(c: Context, name: string): string {
  return uuid.parse(c.req.param(name));
}
