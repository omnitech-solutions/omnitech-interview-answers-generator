import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  token?: string;
  url?: string;
}

export const configPath = join(
  homedir(),
  ".config",
  "omnitech-interview-answers",
  "config.json",
);

export async function readConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as CliConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}
