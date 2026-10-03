import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** Load optional development files without replacing exported shell values. */
export function loadDevEnvironment(
  exported = process.env,
  rootFile = ".env",
  webFile = "apps/web/.env.local",
) {
  const environment = { ...exported };
  const exportedNames = new Set(Object.keys(exported));
  for (const file of [rootFile, webFile]) {
    if (!existsSync(file)) continue;
    for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (!exportedNames.has(name)) environment[name] = value;
    }
  }
  return environment;
}
