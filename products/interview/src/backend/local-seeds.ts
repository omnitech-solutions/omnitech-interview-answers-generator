import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

// The development default: `.dev-local/profile/contact.json` of the checkout
// the server runs in (gitignored), found from the working directory upwards
// because a server may start in `apps/web`.
function devContactPath(from: string): string[] {
  const paths: string[] = [];
  for (let directory = from, depth = 0; depth < 5; depth++) {
    paths.push(join(directory, ".dev-local/profile/contact.json"));
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return paths;
}

/**
 * The person's contact details (email, phone, portfolio), kept on this machine
 * and out of git. The first file that exists is read: `INTERVIEW_CONTACT_PATH`,
 * `profile/contact.json` under the data directory, then the development
 * default. Production never loads a workstation's file. The values are never
 * logged; a file that is not a JSON object of strings is ignored.
 */
export async function loadLocalContact({
  env = process.env,
  directory = process.cwd(),
  production = process.env["NODE_ENV"] === "production",
}: {
  env?: NodeJS.ProcessEnv;
  directory?: string;
  production?: boolean;
} = {}): Promise<{
  email?: string;
  phone?: string;
  portfolio?: string;
} | null> {
  if (production) return null;
  for (const path of [
    env["INTERVIEW_CONTACT_PATH"],
    env["INTERVIEW_DATA_DIR"]
      ? join(env["INTERVIEW_DATA_DIR"], "profile/contact.json")
      : undefined,
    ...devContactPath(directory),
  ]) {
    if (!path) continue;
    const raw = await readFile(path, "utf8").catch(() => null);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const value = (key: string) => {
      const found = (parsed as Record<string, unknown>)[key];
      return typeof found === "string" && found.trim()
        ? { [key]: found.trim().slice(0, 320) }
        : {};
    };
    return { ...value("email"), ...value("phone"), ...value("portfolio") };
  }
  return null;
}
