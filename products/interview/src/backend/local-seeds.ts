import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type BuiltInKey,
  builtInTemplates,
} from "./documents/built-in-templates";

// Private local data (the experience matrix, the author's real templates)
// lives with the source studio rather than in this repository or in the
// gitignored `.data`. Production never loads a workstation's files.
const STUDIO = join(homedir(), "dev/omnitech-solutions/docx-generator-studio");

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** The first experience matrix that exists; undefined falls back to `.data`. */
export async function localMatrixPath(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  for (const path of [
    env["INTERVIEW_DEFAULT_MATRIX_PATH"],
    env["INTERVIEW_EXPERIENCE_MATRIX_PATH"],
    join(STUDIO, "server/data/profiles/my-experience-matrix.json"),
  ])
    if (path && (await exists(path))) return path;
  return undefined;
}

/** The author's own template files, by built-in key, when they exist. */
export async function loadLocalTemplates({
  directory = process.env["INTERVIEW_TEMPLATES_DIR"] ??
    join(STUDIO, "template"),
  production = process.env["NODE_ENV"] === "production",
}: {
  directory?: string;
  production?: boolean;
} = {}): Promise<Partial<Record<BuiltInKey, Buffer>> | null> {
  if (production) return null;
  const found: Partial<Record<BuiltInKey, Buffer>> = {};
  for (const template of builtInTemplates()) {
    const bytes = await readFile(join(directory, template.localFile)).catch(
      () => null,
    );
    if (bytes) found[template.key] = bytes;
  }
  return Object.keys(found).length ? found : null;
}
