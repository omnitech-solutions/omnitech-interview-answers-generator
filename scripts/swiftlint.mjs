// SwiftLint gate (correctness and complexity; layout belongs to swift-format).
//   node scripts/swiftlint.mjs [files...]   no files: lint every tracked .swift file
// Uses .swiftlint.yml and .swiftlint.baseline.json (only NEW findings fail) and --strict.
// Skips only off macOS; on macOS a missing swiftlint FAILS with an install hint.
// Regenerate the baseline: node scripts/swiftlint.mjs --write-baseline
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const writeBaseline = args.includes("--write-baseline");
const staged = args.filter((arg) => !arg.startsWith("--"));

if (process.platform !== "darwin") {
  console.log("swiftlint skipped: not macOS");
  process.exit(0);
}
if (spawnSync("swiftlint", ["version"], { stdio: "ignore" }).status === null) {
  console.error("swiftlint is not installed. Install it with: brew install swiftlint");
  process.exit(1);
}

// With only the Command Line Tools (no Xcode), SwiftLint cannot find sourcekitd
// unless TOOLCHAIN_DIR names the developer directory.
const env = { ...process.env };
if (!env.TOOLCHAIN_DIR) {
  const developerDir = spawnSync("xcode-select", ["-p"], { encoding: "utf8" }).stdout.trim();
  if (developerDir && !developerDir.includes("Xcode")) env.TOOLCHAIN_DIR = developerDir;
}

// Only files the config lints (Package.swift manifests are swift-format's alone).
const linted = /^apps\/(studio-shell|capture-companion\/macos)\/(Sources|Tests)\//;
const files = staged.map((file) => file.replace(`${root}/`, "")).filter((file) => linted.test(file));
if (staged.length > 0 && files.length === 0) process.exit(0);

const base = ["lint", "--quiet", "--strict", "--config", ".swiftlint.yml"];
const command = writeBaseline
  ? [...base, "--write-baseline", ".swiftlint.baseline.json"]
  : [...base, "--baseline", ".swiftlint.baseline.json"];
const run = spawnSync("swiftlint", [...command, ...files], { cwd: root, env, stdio: "inherit" });
process.exit(run.status ?? 1);
