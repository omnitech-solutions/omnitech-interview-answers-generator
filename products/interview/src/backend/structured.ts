import type { z } from "zod";
import { WorkspaceError, type WorkspaceScope } from "./assistant/workspace";

// One-shot structured generation for the product's JSON replies (briefs,
// behavioural briefings).
export type StructuredGenerate = (
  // `schema` is the reply's JSON Schema. The AI engine asks the provider for
  // that shape, checks the answer and repairs it once (ADR-0037).
  input: { system: string; prompt: string; schema: Record<string, unknown> },
  scope: WorkspaceScope,
) => Promise<unknown>;

// [STRATEGY] The reply's shape is the engine's to enforce: it sends the schema
// in the provider's own structured format, validates the answer, and makes one
// repair turn when it misses. What is checked here is the product's own
// contract (the zod schema, with its refinements and defaults), once, on the
// value the engine returned.
export async function generateChecked<T>(
  generate: StructuredGenerate,
  request: { system: string; prompt: string },
  schema: z.ZodType<T>,
  scope: WorkspaceScope,
): Promise<T> {
  // An agent runtime's own schema check cannot resolve zod's "$schema" draft
  // reference, so the schema travels without it.
  const { $schema: _draft, ...jsonSchema } = schema.toJSONSchema({
    unrepresentable: "any",
  }) as Record<string, unknown>;
  let reply: unknown;
  try {
    reply = await generate({ ...request, schema: jsonSchema }, scope);
  } catch {
    throw new WorkspaceError(
      "generation-failed",
      "The model could not be reached, did not reply in time, or did not reply in the required format.",
    );
  }
  const checked = schema.safeParse(reply);
  if (checked.success) return checked.data;
  // [SAFETY] The hint names fields and expectations only, never content.
  throw new WorkspaceError(
    "generation-failed",
    `The model's reply did not match the required format: ${issues(checked.error).join("; ")}`,
  );
}

function issues(error: z.ZodError): string[] {
  return [
    ...new Set(
      error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    ),
  ].slice(0, 8);
}
