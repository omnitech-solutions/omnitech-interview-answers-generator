import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFUSAL_CODES } from "./control";
import { WIRE_VERSION } from "./ids";
import { buildWireSchema, COMPANION_MESSAGE_KINDS } from "./wire-schema";

const schemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "schema",
  "active-session-wire.schema.json",
);
type Json = {
  type?: unknown;
  properties?: unknown;
  additionalProperties?: unknown;
  const?: unknown;
  wireVersion?: unknown;
  messageKinds?: unknown;
  companionMessage?: unknown;
};
const committed = JSON.parse(readFileSync(schemaPath, "utf8")) as Json;
const walk = (node: unknown, visit: (object: Json) => void): void => {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (typeof node === "object" && node !== null) {
    visit(node as Json);
    for (const child of Object.values(node)) walk(child, visit);
  }
};

describe("generated wire schema", () => {
  it("matches the committed file (run schema:generate on drift)", () => {
    expect(JSON.parse(JSON.stringify(buildWireSchema()))).toEqual(committed);
  });

  it("closes every message object with additionalProperties:false", () => {
    let objects = 0;
    walk(committed, (node) => {
      if (node.type === "object" && node.properties !== undefined) {
        objects += 1;
        expect(node.additionalProperties).toBe(false);
      }
    });
    expect(objects).toBeGreaterThan(10);
  });

  it("lists every companion message kind and the wire version", () => {
    expect(committed.wireVersion).toBe(WIRE_VERSION);
    expect(committed.messageKinds).toEqual([...COMPANION_MESSAGE_KINDS]);
    const consts: unknown[] = [];
    walk(committed.companionMessage, (node) => {
      if ("const" in node) consts.push(node.const);
    });
    for (const kind of COMPANION_MESSAGE_KINDS) expect(consts).toContain(kind);
    expect(consts).toContain(WIRE_VERSION);
  });

  it("has no audio kind and carries every refusal code", () => {
    const text = JSON.stringify(committed);
    expect(text).not.toContain("audio.");
    for (const code of REFUSAL_CODES) expect(text).toContain(code);
  });
});
