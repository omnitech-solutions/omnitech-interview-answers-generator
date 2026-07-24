import { chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

type Runtime = {
  platform: NodeJS.Platform;
  arch: string;
  packageRoot?: string;
};

export function ensureNodePtySpawnHelperExecutable({
  platform,
  arch,
  packageRoot,
}: Runtime): void {
  if (platform === "win32") return;

  const root = packageRoot ?? dirname(require.resolve("node-pty/package.json"));
  const helper = join(root, "prebuilds", `${platform}-${arch}`, "spawn-helper");
  const mode = statSync(helper).mode;

  if ((mode & 0o111) !== 0o111) {
    chmodSync(helper, mode | 0o111);
  }
}
