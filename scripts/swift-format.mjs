// Apple swift-format gate (layout), configured by .swift-format.
//   node scripts/swift-format.mjs [--write] [files...]   no files: every tracked .swift file
// Lints with --strict; --write rewrites in place. Skips only off macOS (xcrun is
// part of the Command Line Tools); a missing swift-format FAILS on macOS.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const write = args.includes("--write");
const given = args.filter((arg) => !arg.startsWith("--"));

if (process.platform !== "darwin") {
  console.log("swift-format skipped: not macOS");
  process.exit(0);
}
if (spawnSync("xcrun", ["--find", "swift-format"], { stdio: "ignore" }).status !== 0) {
  console.error(
    "swift-format is not available. Install the Xcode Command Line Tools (xcode-select --install); it ships with Swift 6.",
  );
  process.exit(1);
}

const tracked = () =>
  spawnSync("git", ["ls-files", "*.swift"], { cwd: root, encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean);
const files = (given.length > 0 ? given : tracked()).filter((file) => file.endsWith(".swift"));
if (files.length === 0) process.exit(0);

const mode = write ? ["format", "--in-place"] : ["lint", "--strict"];
const run = spawnSync("xcrun", ["swift-format", ...mode, "--configuration", ".swift-format", ...files], {
  cwd: root,
  stdio: "inherit",
});
if (run.status !== 0 && !write) console.error("swift-format: run `pnpm format:swift:write` to fix layout.");
process.exit(run.status ?? 1);
