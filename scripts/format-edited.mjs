// Formats the one file an agent has just written, so a formatting error never
// reaches the gate. Run by the editor hook in .claude/settings.json after every
// Edit or Write; the hook's JSON arrives on stdin. Formatting only: lint fixes
// change code and stay a deliberate step (`pnpm fix`).
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const FORMATTED = /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc)$/;

let given = "";
for await (const chunk of process.stdin) given += chunk;
let file;
try {
  file = JSON.parse(given)?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (typeof file !== "string" || !FORMATTED.test(file)) process.exit(0);
// Only files of this repository: never a path elsewhere on the machine.
const inside = relative(root, resolve(file));
if (inside.startsWith("..") || inside.includes("node_modules")) process.exit(0);

// A file Biome ignores, or one that does not parse yet, is left as it is: the
// hook never fails an edit.
spawnSync(
  "pnpm",
  ["exec", "biome", "format", "--write", "--no-errors-on-unmatched", inside],
  { cwd: root, stdio: "ignore" },
);
process.exit(0);
