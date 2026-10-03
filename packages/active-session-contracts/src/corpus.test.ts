import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acknowledgementSchema,
  REFUSAL_CODES,
  validateIngestMessage,
} from "./control.js";
import { buildCorpusManifest, COMPANION_MESSAGE_KINDS } from "./wire-schema.js";

const corpusRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "corpus",
);
const readJson = (file: string) =>
  JSON.parse(readFileSync(join(corpusRoot, file), "utf8")) as unknown;
const files = ["valid", "invalid"].flatMap((dir) =>
  readdirSync(join(corpusRoot, dir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      file: `${dir}/${name}`,
      json: readJson(`${dir}/${name}`),
    })),
);
const manifest = readJson("index.json") as ReturnType<
  typeof buildCorpusManifest
>;

describe("corpus manifest", () => {
  it("matches the files on disk (run schema:generate on drift)", () => {
    expect(manifest).toEqual(buildCorpusManifest(files));
  });

  it("lists every message kind and every refusal code as valid", () => {
    const valid = manifest.entries.filter((entry) => entry.outcome === "valid");
    const kinds = valid.map((entry) => entry.kind);
    for (const kind of COMPANION_MESSAGE_KINDS) expect(kinds).toContain(kind);
    for (const status of ["accepted", "duplicate", "refused"]) {
      expect(kinds).toContain(`acknowledgement.${status}`);
    }
    const refused = valid
      .filter((entry) => entry.kind === "acknowledgement.refused")
      .map((entry) => (readJson(entry.file) as { code: string }).code);
    expect(refused.sort()).toEqual([...REFUSAL_CODES].sort());
  });

  it("covers every disconnect and gap reason and both transcript sources", () => {
    const text = JSON.stringify(
      files.filter((f) => f.file.startsWith("valid/")),
    );
    for (const reason of [
      "user-stopped",
      "permission-revoked",
      "device-lost",
      "buffer-overflow",
      "source-interrupted",
      "paused",
    ]) {
      expect(text).toContain(`"reason":"${reason}"`);
    }
    for (const source of ["microphone", "application-audio"]) {
      expect(text).toContain(`"source":"${source}"`);
    }
    expect(text).toContain('"payloadRef"');
  });
});

describe("corpus conformance", () => {
  for (const entry of manifest.entries) {
    it(`${entry.outcome}: ${entry.file}`, () => {
      const json = readJson(entry.file);
      if (entry.outcome === "invalid") {
        const {
          description,
          message,
          expect: expected,
        } = json as {
          description: string;
          message: unknown;
          expect: { ok: false; issueCodes: string[] };
        };
        expect(description.length).toBeGreaterThan(0);
        expect(expected.ok).toBe(false);
        const result = validateIngestMessage(message);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.issues.map((issue) => issue.code)).toEqual(
            expected.issueCodes,
          );
        }
      } else if (entry.family === "acknowledgement") {
        expect(acknowledgementSchema.safeParse(json).success).toBe(true);
      } else {
        const result = validateIngestMessage(json);
        expect(result.ok).toBe(true);
      }
    });
  }
});
