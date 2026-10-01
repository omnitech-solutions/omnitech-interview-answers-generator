import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
export function parseStructuredOutput(
  text: string,
  schema?: Readonly<Record<string, unknown>>,
): unknown {
  const value: unknown = JSON.parse(text);
  if (schema) {
    // Supplied schemas must not share an ID registry across requests.
    const dialect = schema["$schema"];
    if (
      dialect !== undefined &&
      dialect !== "http://json-schema.org/draft-07/schema" &&
      dialect !== "http://json-schema.org/draft-07/schema#" &&
      dialect !== "https://json-schema.org/draft/2020-12/schema" &&
      dialect !== "https://json-schema.org/draft/2020-12/schema#"
    )
      throw new Error(`Unsupported JSON Schema dialect: ${String(dialect)}`);
    const ajv =
      dialect === "https://json-schema.org/draft/2020-12/schema" ||
      dialect === "https://json-schema.org/draft/2020-12/schema#"
        ? new Ajv2020({ strict: true, allErrors: true })
        : new Ajv({ strict: true, allErrors: true });
    const validate = ajv.compile(schema);
    if (!validate(value))
      throw new Error(
        `Structured output validation failed: ${ajv.errorsText(validate.errors)}`,
      );
  }
  return value;
}
