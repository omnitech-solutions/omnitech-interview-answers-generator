import { Ajv } from "ajv";
const ajv = new Ajv({ strict: true, allErrors: true });
export function parseStructuredOutput(
  text: string,
  schema?: Readonly<Record<string, unknown>>,
): unknown {
  const value: unknown = JSON.parse(text);
  if (schema) {
    const validate = ajv.compile(schema);
    if (!validate(value))
      throw new Error(
        `Structured output validation failed: ${ajv.errorsText(validate.errors)}`,
      );
  }
  return value;
}
