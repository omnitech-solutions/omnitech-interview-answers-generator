// Regenerates the published wire artifacts from the package's own source:
// schema/active-session-wire.schema.json and corpus/index.json. Run through
// `pnpm --filter @omnitech/active-session-contracts schema:generate`, which
// formats the output. Nothing here is needed at runtime.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCorpusManifest,
  buildWireSchema,
  serializeWireSchema,
} from "../src/wire-schema.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpusRoot = join(packageRoot, "corpus");

const files = ["valid", "invalid"].flatMap((dir) =>
  readdirSync(join(corpusRoot, dir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      file: `${dir}/${name}`,
      json: JSON.parse(readFileSync(join(corpusRoot, dir, name), "utf8")),
    })),
);

writeFileSync(
  join(packageRoot, "schema", "active-session-wire.schema.json"),
  serializeWireSchema(buildWireSchema()),
);
writeFileSync(
  join(corpusRoot, "index.json"),
  `${JSON.stringify(buildCorpusManifest(files), null, 2)}\n`,
);
