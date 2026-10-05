import type { z } from "zod";
import { WorkspaceError, type WorkspaceScope } from "./assistant/workspace";

// One-shot structured generation for the product's JSON replies (briefs,
// behavioural briefings).
export type StructuredGenerate = (
  input: { system: string; prompt: string },
  scope: WorkspaceScope,
) => Promise<unknown>;

// [STRATEGY] The reply's shape is stated in the instructions rather than
// enforced by strict JSON-schema decoding, which local models are slow at
// (over 180 s against about 35 s). The reply is validated here; a reply that
// misses the shape gets one correction turn listing exactly what failed.
export async function generateChecked<T>(
  generate: StructuredGenerate,
  request: { system: string; prompt: string },
  schema: z.ZodType<T>,
  scope: WorkspaceScope,
): Promise<T> {
  const shape = JSON.stringify(schema.toJSONSchema({ unrepresentable: "any" }));
  const system = `${request.system}\nReply with one JSON object that matches this JSON Schema: ${shape}`;
  const first = await ask({ system, prompt: request.prompt });
  const firstCheck = schema.safeParse(first);
  if (firstCheck.success) return firstCheck.data;

  const second = await ask({
    system,
    prompt: [
      request.prompt,
      "",
      "Your previous reply was:",
      JSON.stringify(first),
      "",
      "It does not match the required format:",
      ...issues(firstCheck.error).map((issue) => `- ${issue}`),
      "Return the complete corrected JSON object only.",
    ].join("\n"),
  });
  const secondCheck = schema.safeParse(second);
  if (secondCheck.success) return secondCheck.data;
  // [SAFETY] The hint names fields and expectations only, never content.
  throw new WorkspaceError(
    "generation-failed",
    `The model's reply did not match the required format, even after one correction: ${issues(secondCheck.error).join("; ")}`,
  );

  async function ask(input: { system: string; prompt: string }) {
    try {
      return await generate(input, scope);
    } catch {
      throw new WorkspaceError(
        "generation-failed",
        "The model could not be reached or did not reply in time.",
      );
    }
  }
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
