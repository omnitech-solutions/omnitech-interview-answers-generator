// OpenAI's strict structured-output mode (what Codex's `outputSchema` uses)
// accepts only a schema in which every object lists ALL of its properties in
// `required` and forbids extra keys. A product schema with an optional property
// is rejected by the server (`invalid_json_schema`), so the adapter converts it
// on the way out and converts the answer back on the way in:
//
//   out: an optional property becomes required and nullable;
//   in : a null for a property the product schema did not require is dropped,
//        so the product still validates the shape it defined.
//
// Both walks are pure and cover nested objects, arrays and unions.

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nullable = (schema: Schema): Schema => {
  // A closed value set must admit null, or the model has to invent a member.
  if (Array.isArray(schema["enum"]))
    return schema["enum"].includes(null)
      ? schema
      : { ...schema, enum: [...schema["enum"], null] };
  if ("const" in schema) {
    const { const: only, ...rest } = schema;
    return { ...rest, enum: [only, null] };
  }
  const type = schema["type"];
  if (typeof type === "string")
    return type === "null" ? schema : { ...schema, type: [type, "null"] };
  if (Array.isArray(type))
    return type.includes("null")
      ? schema
      : { ...schema, type: [...type, "null"] };
  const union = schema["anyOf"];
  if (Array.isArray(union))
    return union.some((member) => isSchema(member) && member["type"] === "null")
      ? schema
      : { ...schema, anyOf: [...union, { type: "null" }] };
  return { anyOf: [schema, { type: "null" }] };
};

const COMBINATORS = ["anyOf", "oneOf", "allOf"] as const;
const DEFINITIONS = ["$defs", "definitions"] as const;

export function strictSchema(schema: Schema): Schema {
  const next: Schema = { ...schema };
  const properties = schema["properties"];
  if (isSchema(properties)) {
    const required = new Set(
      Array.isArray(schema["required"]) ? (schema["required"] as string[]) : [],
    );
    const strict: Schema = {};
    for (const [key, value] of Object.entries(properties)) {
      const child = isSchema(value) ? strictSchema(value) : {};
      strict[key] = required.has(key) ? child : nullable(child);
    }
    next["properties"] = strict;
    next["required"] = Object.keys(strict);
    next["additionalProperties"] = false;
  }
  if (isSchema(schema["items"])) next["items"] = strictSchema(schema["items"]);
  for (const name of COMBINATORS) {
    const members = schema[name];
    if (Array.isArray(members))
      next[name] = members.map((member) =>
        isSchema(member) ? strictSchema(member) : member,
      );
  }
  for (const name of DEFINITIONS) {
    const definitions = schema[name];
    if (isSchema(definitions))
      next[name] = Object.fromEntries(
        Object.entries(definitions).map(([key, value]) => [
          key,
          isSchema(value) ? strictSchema(value) : value,
        ]),
      );
  }
  return next;
}

const allowsNull = (schema: unknown): boolean => {
  if (!isSchema(schema)) return false;
  const type = schema["type"];
  if (type === "null" || (Array.isArray(type) && type.includes("null")))
    return true;
  if (Array.isArray(schema["enum"]) && schema["enum"].includes(null))
    return true;
  return (
    Array.isArray(schema["anyOf"]) && schema["anyOf"].some((m) => allowsNull(m))
  );
};

// A local `$ref` ("#/$defs/name" or "#/definitions/name"), else the schema.
function resolve(schema: Schema, root: Schema): Schema {
  const ref = schema["$ref"];
  if (typeof ref !== "string") return schema;
  const match = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref);
  const group = match?.[1] ? root[match[1]] : undefined;
  const target = match?.[2] && isSchema(group) ? group[match[2]] : undefined;
  return isSchema(target) ? target : schema;
}

// Of a union's object members, the one that declares every key the value has
// (the first when none does); other union members carry no object shape.
function member(value: Record<string, unknown>, schema: Schema): Schema {
  const members = [schema["anyOf"], schema["oneOf"]]
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .filter((m): m is Schema => isSchema(m) && !!m["properties"]);
  const keys = Object.keys(value).filter((key) => value[key] !== null);
  return (
    members.find((m) =>
      keys.every((key) => key in (m["properties"] as Schema)),
    ) ??
    members[0] ??
    schema
  );
}

// Drops a null the product schema did not allow; keeps every other value as is
// (including a null that the product schema itself permits).
export function restoreOptional(
  value: unknown,
  original: Schema,
  root: Schema = original,
): unknown {
  const schema = resolve(original, root);
  if (Array.isArray(value)) {
    const items = schema["items"];
    return isSchema(items)
      ? value.map((entry) => restoreOptional(entry, items, root))
      : value;
  }
  if (!isSchema(value)) return value;
  const shape = isSchema(schema["properties"]) ? schema : member(value, schema);
  const resolved = resolve(shape, root);
  const properties = resolved["properties"];
  if (!isSchema(properties)) return value;
  const required = new Set(
    Array.isArray(resolved["required"])
      ? (resolved["required"] as string[])
      : [],
  );
  const restored: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const child = properties[key];
    if (
      entry === null &&
      !required.has(key) &&
      key in properties &&
      !allowsNull(child)
    )
      continue;
    restored[key] = isSchema(child)
      ? restoreOptional(entry, child, root)
      : entry;
  }
  return restored;
}
