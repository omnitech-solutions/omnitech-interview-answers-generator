import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Optional private local data. Production never loads a workstation profile. */
export async function loadLocalDefaultProfile({
  directory = process.cwd(),
  dataDirectory = process.env["INTERVIEW_DATA_DIR"],
  path = process.env["INTERVIEW_DEFAULT_MATRIX_PATH"],
  production = process.env["NODE_ENV"] === "production",
}: {
  directory?: string;
  dataDirectory?: string;
  path?: string;
  production?: boolean;
} = {}): Promise<{ name: string; matrix: unknown } | null> {
  if (production) return null;
  let raw: string;
  try {
    raw = await readFile(
      path ??
        join(
          dataDirectory ?? join(directory, ".data"),
          "default-experience-matrix.json",
        ),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (Buffer.byteLength(raw, "utf8") > 1_048_576)
    throw new Error("Default profile exceeds the import limit.");
  return { name: "My experience matrix", matrix: JSON.parse(raw) as unknown };
}
